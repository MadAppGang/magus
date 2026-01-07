# Design: Hook to Replace Built-in Explore Agent

**Session**: agentdev-explore-hook-20260107-222831-e76a
**Date**: 2026-01-07
**Type**: Hook Enhancement (PreToolUse)
**Plugin**: code-analysis v2.12.0

---

## Overview

This design adds Task tool interception to the code-analysis plugin's PreToolUse hook. When Claude Code attempts to launch the built-in `Explore` subagent, the hook denies the request and redirects to the `code-analysis:detective` agent, which provides AST-based structural analysis via claudemem.

---

## Problem Statement

The code-analysis plugin (v2.12.0) successfully intercepts search tools (Grep, Bash, Glob, Read) and replaces them with claudemem AST analysis. However, when Claude Code spawns the built-in `Explore` agent:

```typescript
Task({
  subagent_type: "Explore",
  prompt: "Find all authentication handlers...",
  description: "Explore codebase"
})
```

This **bypasses** all hook interception because:
1. `Explore` is a built-in subagent, not a tool
2. The Task tool itself is not currently intercepted
3. The Explore agent uses traditional search methods (grep, find, glob)

**Result**: Users lose the benefits of AST structural analysis when Claude Code autonomously decides to use Explore.

---

## Solution Design

### Approach: PreToolUse Hook on Task Tool

Intercept the `Task` tool at the PreToolUse stage. When `tool_input.subagent_type === "Explore"`, deny the tool use and return context explaining to use `code-analysis:detective` instead.

**Key Insight**: The hook system processes Task tool calls before they execute, providing access to `tool_input` which contains the `subagent_type` field.

---

## Implementation Details

### 1. Plugin.json Changes

**File**: `plugins/code-analysis/plugin.json`

**Current PreToolUse Section** (lines 38-48):
```json
"PreToolUse": [
  {
    "matcher": "Grep|Bash|Glob|Read",
    "hooks": [
      {
        "type": "command",
        "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts\""
      }
    ]
  }
]
```

**New PreToolUse Section**:
```json
"PreToolUse": [
  {
    "matcher": "Grep|Bash|Glob|Read",
    "hooks": [
      {
        "type": "command",
        "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts\""
      }
    ]
  },
  {
    "matcher": "Task",
    "hooks": [
      {
        "type": "command",
        "command": "bun \"${CLAUDE_PLUGIN_ROOT}/hooks/handler.ts\""
      }
    ]
  }
]
```

**Rationale**: Separate matchers allow different handling logic and make the configuration clearer. The handler.ts already dispatches based on `tool_name`.

---

### 2. Handler.ts Changes

**File**: `plugins/code-analysis/hooks/handler.ts`

#### 2.1 Add handleTaskIntercept Function

Add this function after `handleReadIntercept` (around line 360):

```typescript
// =============================================================================
// TASK INTERCEPT HANDLER (Explore Agent Replacement)
// =============================================================================

async function handleTaskIntercept(input: HookInput): Promise<HookOutput | null> {
  const toolInput = input.tool_input as {
    subagent_type?: string;
    prompt?: string;
    description?: string;
  } | undefined;

  if (!toolInput) return null;

  const subagentType = toolInput.subagent_type;

  // Only intercept the built-in Explore agent
  // Case-insensitive check to handle potential variations
  if (!subagentType || subagentType.toLowerCase() !== "explore") {
    return null; // Allow all other Task calls to proceed
  }

  // Check if claudemem is indexed for this project
  const status = isIndexed(input.cwd);

  if (!status.indexed) {
    // If not indexed, allow Explore but suggest indexing
    return {
      additionalContext: `**Explore agent bypassing AST analysis** - claudemem not indexed.

For structural code navigation with PageRank ranking, run:
\`\`\`bash
claudemem index
\`\`\`

Then use \`code-analysis:detective\` agent instead of Explore.`,
    };
  }

  // Extract the search intent from the prompt
  const prompt = toolInput.prompt || "";
  const description = toolInput.description || "";
  const searchContext = prompt || description;

  // Run claudemem map to provide structural overview
  let mapResults: string | null = null;
  if (searchContext) {
    // Extract potential keywords from the prompt
    const keywords = extractSearchKeywords(searchContext);
    if (keywords) {
      mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
    }
  }

  // Build helpful context for the redirect
  const structuralOverview = mapResults
    ? `\n**Structural Overview** (from claudemem map):\n${mapResults}\n`
    : "";

  return {
    additionalContext: `**Explore agent intercepted** - Use \`code-analysis:detective\` instead.

The code-analysis plugin provides AST-based structural analysis with PageRank ranking,
which is more effective than the built-in Explore agent's grep/find approach.
${structuralOverview}
**How to use code-analysis:detective:**

\`\`\`typescript
Task({
  subagent_type: "code-analysis:detective",
  prompt: "${escapeForTemplate(searchContext || "your search query")}",
  description: "Investigate codebase structure"
})
\`\`\`

**What detective provides:**
- AST structural analysis (not just text matching)
- PageRank symbol importance ranking
- Caller/callee dependency tracing
- Semantic code navigation

**claudemem commands available:**
- \`claudemem --agent map "query"\` - Structural overview
- \`claudemem --agent symbol <name>\` - Find definition
- \`claudemem --agent callers <name>\` - Impact analysis
- \`claudemem --agent callees <name>\` - Dependency analysis`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Explore agent replaced with code-analysis:detective for AST structural analysis. See context above for how to use detective.",
    },
  };
}

// Helper: Extract search keywords from natural language prompt
function extractSearchKeywords(text: string): string | null {
  if (!text) return null;

  // Remove common question words and filler
  const cleaned = text
    .toLowerCase()
    .replace(/\b(find|search|look|locate|where|what|how|is|are|the|a|an|in|for|all|any)\b/g, " ")
    .replace(/[?!.,;:'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Return if we have meaningful keywords
  if (cleaned.length > 2) {
    return cleaned;
  }

  // Fall back to first 5 words of original
  const words = text.split(/\s+/).slice(0, 5).join(" ");
  return words.length > 2 ? words : null;
}

// Helper: Escape string for template literal display
function escapeForTemplate(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .substring(0, 200); // Limit length for display
}
```

#### 2.2 Update Main Dispatcher

Update the `PreToolUse` case in the main dispatcher (around line 470):

**Current** (lines 470-484):
```typescript
case "PreToolUse":
  switch (input.tool_name) {
    case "Grep":
      output = await handleGrepIntercept(input);
      break;
    case "Bash":
      output = await handleBashIntercept(input);
      break;
    case "Glob":
      output = await handleGlobIntercept(input);
      break;
    case "Read":
      output = await handleReadIntercept(input);
      break;
  }
  break;
```

**New**:
```typescript
case "PreToolUse":
  switch (input.tool_name) {
    case "Grep":
      output = await handleGrepIntercept(input);
      break;
    case "Bash":
      output = await handleBashIntercept(input);
      break;
    case "Glob":
      output = await handleGlobIntercept(input);
      break;
    case "Read":
      output = await handleReadIntercept(input);
      break;
    case "Task":
      output = await handleTaskIntercept(input);
      break;
  }
  break;
```

---

### 3. Edge Cases and Safety

#### 3.1 Case Sensitivity

The check uses `toLowerCase()` to handle variations:
- `"Explore"` - matches
- `"explore"` - matches
- `"EXPLORE"` - matches

#### 3.2 Only Intercept Exact Explore

The check is exact match, so these are **NOT** intercepted:
- `"code-analysis:detective"` - allowed
- `"frontend:developer"` - allowed
- `"agentdev:reviewer"` - allowed
- `"general-purpose"` - allowed
- `"ExploreCode"` - allowed (not exact match)

#### 3.3 Not Indexed Fallback

If claudemem is not indexed:
1. Allow Explore to proceed (don't deny)
2. Add context suggesting user index and use detective
3. User experience is preserved for projects without claudemem

#### 3.4 Empty/Null Checks

All input fields are defensively checked:
- `tool_input` may be undefined
- `subagent_type` may be missing
- `prompt` and `description` may be empty

---

### 4. Type Updates

Add the Task-specific fields to the tool_input type hint (optional but helpful):

```typescript
// Near line 29, update or add type hint comment:
// tool_input for Task: { subagent_type?: string; prompt?: string; description?: string; }
```

---

## Testing Strategy

### Manual Testing

1. **Test Explore Interception**:
   ```typescript
   // Should be denied
   Task({
     subagent_type: "Explore",
     prompt: "Find all API endpoints"
   })
   ```
   Expected: Denied with redirect to detective

2. **Test Non-Explore Allowed**:
   ```typescript
   // Should proceed normally
   Task({
     subagent_type: "frontend:developer",
     prompt: "Implement feature"
   })
   ```
   Expected: Allowed through

3. **Test Detective Allowed**:
   ```typescript
   // Should proceed normally
   Task({
     subagent_type: "code-analysis:detective",
     prompt: "Investigate authentication"
   })
   ```
   Expected: Allowed through

4. **Test Not Indexed**:
   - Remove `.claudemem/` directory
   - Try Explore again
   Expected: Allowed with suggestion context

### Integration Testing

1. Start Claude Code session in indexed project
2. Ask Claude to explore the codebase
3. Verify it attempts to use Explore
4. Verify hook denies and provides detective redirect
5. Ask Claude to use detective instead
6. Verify AST analysis works

---

## Rollout Plan

### Phase 1: Implementation
1. Update `plugin.json` to add Task matcher
2. Add `handleTaskIntercept` function to handler.ts
3. Update dispatcher switch statement
4. Test locally

### Phase 2: Version Bump
- Update plugin version: `2.12.0` -> `2.13.0`
- Add changelog entry
- Update CLAUDE.md

### Phase 3: Release
- Create git tag: `plugins/code-analysis/v2.13.0`
- Update marketplace.json

---

## Alternative Approaches Considered

### 1. Intercept Inside Explore Agent (Rejected)
- Would require modifying built-in Claude behavior
- Not possible with plugin system

### 2. PostToolUse Interception (Rejected)
- Too late - Explore would have already run
- Can't prevent the search, only add context after

### 3. Match Multiple Tools in Single Matcher (Considered)
```json
"matcher": "Grep|Bash|Glob|Read|Task"
```
- Simpler config but harder to understand
- Current approach with separate matchers is clearer

### 4. Blanket Task Interception (Rejected)
- Would need to check many conditions
- Higher risk of breaking legitimate Task calls
- Current targeted approach is safer

---

## Summary

**Changes Required**:

| File | Change |
|------|--------|
| `plugin.json` | Add Task matcher to PreToolUse hooks |
| `handler.ts` | Add `handleTaskIntercept()` function |
| `handler.ts` | Add `extractSearchKeywords()` helper |
| `handler.ts` | Add `escapeForTemplate()` helper |
| `handler.ts` | Update PreToolUse dispatcher |

**Behavior**:
- When `Task({ subagent_type: "Explore", ... })` is called
- Hook checks if claudemem is indexed
- If indexed: Deny and redirect to `code-analysis:detective`
- If not indexed: Allow with suggestion to index

**Impact**:
- All other Task calls unaffected
- Users get AST-based analysis instead of grep
- Graceful fallback when not indexed

---

## Implementation Checklist

- [ ] Update `plugins/code-analysis/plugin.json` - Add Task matcher
- [ ] Update `plugins/code-analysis/hooks/handler.ts` - Add handleTaskIntercept
- [ ] Update `plugins/code-analysis/hooks/handler.ts` - Add helper functions
- [ ] Update `plugins/code-analysis/hooks/handler.ts` - Update dispatcher
- [ ] Test: Explore interception works
- [ ] Test: Other agents not affected
- [ ] Test: Not-indexed fallback works
- [ ] Update version to 2.13.0
- [ ] Update CLAUDE.md
- [ ] Create release tag
