# Consolidated Plan Review: Explore Agent Hook

**Session**: agentdev-explore-hook-20260107-222831-e76a
**Date**: 2026-01-07
**Models Reviewed**: 5 (Internal, MiniMax*, GLM-4.7, Gemini 3 Pro, GPT-5.2)

*MiniMax failed, review done by Claude fallback

---

## Overall Verdict: CONDITIONAL PASS

All 5 reviewers gave CONDITIONAL status. Core design is sound, but several issues need fixing.

---

## Issue Summary Across All Models

| Issue | Internal | MiniMax | GLM-4 | Gemini | GPT-5 | Consensus |
|-------|----------|---------|-------|--------|-------|-----------|
| Missing `.trim()` on subagent check | ✓ | ✓ | - | - | ✓ | **HIGH** |
| Missing type guard for tool_input | ✓ | - | ✓ | ✓ | ✓ | **HIGH** |
| mapResults computed but not used | - | - | - | ✓ | - | CRITICAL* |
| Explicit allow decision when not indexed | - | ✓ | ✓ | - | - | **HIGH** |
| Performance: sync claudemem map call | ✓ | ✓ | ✓ | ✓ | ✓ | **HIGH** |
| Quote escaping in escapeForTemplate | - | - | - | - | ✓ | MEDIUM |
| Aggressive keyword extraction | - | - | ✓ | ✓ | - | MEDIUM |
| Background Task handling | ✓ | - | - | - | ✓ | MEDIUM |
| Error handling for runCommand | - | ✓ | ✓ | ✓ | - | MEDIUM |

*Note: Gemini's "mapResults not used" is a misread - the design DOES use it in `structuralOverview`, but this highlights need for clarity.

---

## MUST FIX Before Implementation

### 1. Add `.trim()` to Subagent Type Check (3/5 reviewers)
**Current:**
```typescript
if (!subagentType || subagentType.toLowerCase() !== "explore")
```
**Fixed:**
```typescript
if (!subagentType || subagentType.trim().toLowerCase() !== "explore")
```

### 2. Add Type Guard for tool_input (4/5 reviewers)
**Current:**
```typescript
const toolInput = input.tool_input as { subagent_type?: string; ... };
```
**Fixed:**
```typescript
function isTaskInput(input: unknown): input is TaskToolInput {
  if (!input || typeof input !== 'object') return false;
  return true; // Fields are all optional, so object check is sufficient
}
if (!isTaskInput(input.tool_input)) return null;
```

### 3. Add Explicit Permission Decision When Not Indexed (2/5 reviewers)
**Current:** Returns only `additionalContext` (implicit allow)
**Fixed:** Add explicit `permissionDecision: "allow"` for clarity

### 4. Add Shorter Timeout for claudemem map (5/5 reviewers)
**Issue:** Default 10s timeout could cause hook delays
**Fix:** Use 3s timeout for preview queries, fail gracefully

---

## SHOULD FIX Before Release

### 5. Escape Double Quotes in escapeForTemplate (1/5 reviewers)
```typescript
.replace(/"/g, '\\"')
```

### 6. Simplify or Remove Automatic claudemem Map Call (3/5 reviewers)
**Options:**
- A) Remove entirely (simplest, recommended by GLM-4)
- B) Keep but with 3s timeout and graceful fallback
- C) Make optional via environment variable

**Recommendation:** Option B - Keep but with timeout and fallback message

### 7. Add Error Context When claudemem Fails (3/5 reviewers)
```typescript
if (!mapResults) {
  mapResults = "(claudemem map unavailable - try 'claudemem index' to rebuild)";
}
```

---

## Design Strengths Noted

- ✓ Sound architectural approach (5/5)
- ✓ Follows existing handler.ts patterns (5/5)
- ✓ Correct use of PreToolUse interception (5/5)
- ✓ Graceful fallback when not indexed (5/5)
- ✓ Good null/undefined handling (4/5)
- ✓ Well-documented alternative approaches (3/5)

---

## Recommended Final Implementation

```typescript
async function handleTaskIntercept(input: HookInput): Promise<HookOutput | null> {
  // Type guard check
  if (!input.tool_input || typeof input.tool_input !== 'object') return null;

  const toolInput = input.tool_input as {
    subagent_type?: string;
    prompt?: string;
    description?: string;
  };

  const subagentType = toolInput.subagent_type;

  // Only intercept exact "Explore" (with trim for whitespace)
  if (!subagentType || subagentType.trim().toLowerCase() !== "explore") {
    return null;
  }

  const status = isIndexed(input.cwd);

  if (!status.indexed) {
    // EXPLICIT allow with suggestion
    return {
      additionalContext: `**Explore agent bypassing AST analysis** - claudemem not indexed...`,
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "claudemem not indexed - Explore allowed as fallback",
      },
    };
  }

  const prompt = toolInput.prompt || "";
  const description = toolInput.description || "";
  const searchContext = prompt || description;

  // Optional map preview with SHORT timeout
  let mapResults: string | null = null;
  if (searchContext) {
    const keywords = extractSearchKeywords(searchContext);
    if (keywords) {
      try {
        // Use shorter timeout (3s) for preview
        mapResults = runCommandWithTimeout("claudemem", ["--agent", "map", keywords], input.cwd, 3000);
      } catch {
        mapResults = "(claudemem preview unavailable)";
      }
    }
  }

  const structuralOverview = mapResults
    ? `\n**Structural Overview**:\n${mapResults}\n`
    : "";

  return {
    additionalContext: `**Explore agent intercepted** - Use \`code-analysis:detective\` instead.
${structuralOverview}
**How to use:**
\`\`\`typescript
Task({
  subagent_type: "code-analysis:detective",
  prompt: "${escapeForTemplate(searchContext || "your query")}",
})
\`\`\``,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Explore replaced with code-analysis:detective for AST analysis.",
    },
  };
}

function escapeForTemplate(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/"/g, '\\"')  // Added quote escaping
    .substring(0, 200);
}
```

---

## Approval Status

**CONDITIONAL → Ready for implementation with fixes above**

Required fixes (4):
1. ✅ Add `.trim()`
2. ✅ Add type guard
3. ✅ Explicit allow decision
4. ✅ Shorter timeout with fallback

Recommended fixes (3):
5. Quote escaping
6. Simplify map call
7. Error context

---

*Consolidated from 5 model reviews*
