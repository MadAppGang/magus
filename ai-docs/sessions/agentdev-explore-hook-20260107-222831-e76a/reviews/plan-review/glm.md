# Design Review: PreToolUse Hook to Replace Built-in Explore Agent

**Reviewer**: z-ai/glm-4.7 via Claudish
**Date**: 2026-01-07
**Session**: agentdev-explore-hook-20260107-222831-e76a

---

## Executive Summary

**Overall Assessment**: Needs Refinement (7/10)

The design demonstrates a solid understanding of the hook system and addresses a real gap in the code-analysis plugin's interception capabilities. However, there are **several critical issues** that need resolution before implementation:

1. **Critical**: Unclear policy on when to deny vs. allow Explore
2. **Critical**: Missing handling for non-explore Task calls that could also benefit from claudemem
3. **Moderate**: Potential performance and UX issues with automatic claudemem map calls
4. **Minor**: TypeScript type safety improvements needed

---

## 1. Design Completeness

### Strengths

**Well-Understood Problem Space**
- Correctly identifies the gap: Explore agent bypasses hook interception
- Clear understanding that Task tool contains `subagent_type` field
- Recognizes that Explore uses traditional search methods

**Solid Hook Integration Pattern**
- Follows existing pattern from Grep/Bash/Glob handlers
- Proper use of PreToolUse interception
- Returns appropriate HookOutput structure with permission decisions

**Helpful Error Messages**
- Provides clear guidance on using `code-analysis:detective`
- Shows example code snippets
- Explains benefits of AST analysis

### Gaps and Issues

**Missing: Policy Definition**
- **Issue**: Design shows conflicting behavior - sometimes denies, sometimes allows with suggestion
- **Impact**: Users will experience inconsistent behavior
- **Recommendation**: Define clear policy - either:
  - **Option A**: Always deny Explore when indexed (strong enforcement)
  - **Option B**: Always allow Explore with suggestion (guidance only)
  - **Option C**: Deny only for specific query types (smart enforcement)

**Missing: Alternative Subagent Handling**
- **Issue**: Only handles Explore, but other agents (frontend:developer, bun:backend-developer) also use grep/find
- **Impact**: Those agents will still bypass claudemem
- **Recommendation**: Consider broader interception or document limitation clearly

**Missing: Performance Considerations**
- **Issue**: Automatically calling `claudemem map` on every Explore interception could slow down sessions
- **Impact**: Users may experience delays when Explore is called
- **Recommendation**: Make claudemem call optional or add timeout/limits

---

## 2. Edge Cases and Safety

### Well-Handled

**Case Insensitivity**
```typescript
if (!subagentType || subagentType.toLowerCase() !== "explore") {
  return null;
}
```
Correctly handles "Explore", "explore", "EXPLORE"

**Exact Match Protection**
- "code-analysis:detective" allowed
- "ExploreCode" allowed (not exact match)
- Prevents false positives

**Fallback for Unindexed Projects**
- Allows Explore with suggestion when not indexed
- Prevents breaking existing workflows

**Null Safety Checks**
```typescript
if (!toolInput) return null;
const subagentType = toolInput.subagent_type;
if (!subagentType || subagentType.toLowerCase() !== "explore") {
  return null;
}
```
Proper defensive programming

### Issues and Concerns

**Problematic: Automatic claudemem Execution**

```typescript
const keywords = extractSearchKeywords(searchContext);
if (keywords) {
  mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
}
```

**Issues**:
1. **Performance**: `claudemem map` can be slow on large codebases
2. **Blocking**: Runs synchronously with 10s timeout (line 52)
3. **No User Control**: User didn't ask for this analysis
4. **Relevance**: Extracted keywords may not match what Explore would find

**Recommendation**:
- Remove automatic `claudemem map` execution
- Just provide context/suggestion
- Let user decide whether to run `code-analysis:detective`

**Problematic: Inconsistent Permission Decision**

```typescript
if (!status.indexed) {
  return {
    additionalContext: `**Explore agent bypassing AST analysis**...`,
  };
}
```

**Issue**: When not indexed, allows Explore (no `permissionDecision`), but when indexed, denies Explore (`permissionDecision: "deny"`).

**Impact**: Inconsistent behavior that may confuse users.

**Recommendation**: Choose one policy:
- Always deny when indexed
- Always allow with suggestion (no denial)
- Document the difference clearly

**Missing: Timeout and Error Handling**

```typescript
mapResults = runCommand("claudemem", ["--agent", "map", keywords], input.cwd);
```

**Issues**:
1. Uses shared 10s timeout from `runCommand` (may be too short for map)
2. No indication to user if map fails/times out
3. Silent failure - results just won't appear

**Recommendation**:
- Add explicit error handling for map command
- Consider longer timeout or async execution
- Inform user if map fails but still proceed

---

## 3. TypeScript Implementation Quality

### Strengths

**Type Safety**
```typescript
const toolInput = input.tool_input as {
  subagent_type?: string;
  prompt?: string;
  description?: string;
} | undefined;
```
Good type narrowing for Task tool input

**Helper Functions**
```typescript
function extractSearchKeywords(text: string): string | null {
  if (!text) return null;
  // ... keyword extraction logic
}

function escapeForTemplate(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .substring(0, 200);
}
```
- Well-structured, single-responsibility functions
- Proper escape handling for template literals
- Length limit prevents massive output

**Follows Existing Patterns**
- Matches structure of `handleGrepIntercept`, `handleBashIntercept`
- Uses same utility functions (`runCommand`, `isIndexed`)
- Returns consistent `HookOutput` structure

### Issues

**Missing: Type Safety Improvements**

```typescript
const toolInput = input.tool_input as {
  subagent_type?: string;
  prompt?: string;
  description?: string;
} | undefined;
```

**Issue**: Type assertion `as` without runtime validation.

**Recommendation**:
```typescript
function isTaskInput(input: unknown): input is {
  subagent_type?: string;
  prompt?: string;
  description?: string;
} {
  if (typeof input !== 'object' || input === null) return false;
  const taskInput = input as Record<string, unknown>;
  return (
    typeof taskInput.subagent_type === 'string' ||
    typeof taskInput.prompt === 'string' ||
    typeof taskInput.description === 'string'
  );
}

const toolInput = isTaskInput(input.tool_input) ? input.tool_input : undefined;
```

**Problematic: Keyword Extraction Logic**

```typescript
const cleaned = text
  .toLowerCase()
  .replace(/\b(find|search|look|locate|where|what|how|is|are|the|a|an|in|for|all|any)\b/g, " ")
  .replace(/[?\!.,;:'\"]/g, " ")
  .replace(/\s+/g, " ")
  .trim();
```

**Issues**:
1. Removes too many common words, potentially leaving nothing meaningful
2. "is", "are", "the", "a", "an" removal is too aggressive
3. "for", "in" could be keywords in some contexts
4. "all", "any" might be important in queries

**Example**:
```
"Find all the files that handle authentication"
-> "files handle authentication" (after removal)
-> but "all", "the" removed incorrectly
```

**Recommendation**:
- Use simpler approach: just split on whitespace and take first 3-5 words
- Or use stopword list with more careful selection
- Or rely on claudemem's own query parsing

---

## 4. Potential Issues

### Critical Issues

**Issue #1: UX Confusion from Inconsistent Denial**
- **Scenario**: User indexes project, Explore gets denied. User runs `claudemem clear`, Explore gets allowed.
- **Impact**: Behavior changes without user action, may cause confusion
- **Recommendation**: Either always deny Explore (strong) or always allow with suggestion (weak), but be consistent

**Issue #2: Performance Degradation**
- **Scenario**: User's codebase has 10k+ files, Explore called 5+ times in session
- **Impact**: Each call runs `claudemem map` synchronously, could take 30+ seconds total
- **Recommendation**: Remove automatic map execution, just provide guidance

**Issue #3: Breaking Existing Workflows**
- **Scenario**: User has scripts that call Explore agent
- **Impact**: These scripts may break if Explore is denied
- **Recommendation**: Add flag or environment variable to disable interception

### Moderate Issues

**Issue #4: Missing Agent Selection Logic**
- **Scenario**: User queries "find all authentication bugs"
- **Impact**: Explore is denied, suggested to use `code-analysis:detective`, but `debugger-detective` might be better
- **Recommendation**: Add smart agent selection based on query type

**Issue #5: No Fallback for Failed Map**
- **Scenario**: `claudemem map` fails or times out
- **Impact**: No map results shown, no error message, user left confused
- **Recommendation**: Add error handling and fallback message

### Minor Issues

**Issue #6: Hardcoded "Explore" String**
- **Issue**: Magic string repeated in multiple places
- **Recommendation**: Extract to constant `const EXPLORE_AGENT = "explore"`

**Issue #7: Missing Tests in Design**
- **Issue**: Testing strategy mentions 4 cases but doesn't specify expected outputs
- **Recommendation**: Define exact expected output for each test case

---

## 5. Recommendations

### High Priority (Must Fix Before Implementation)

1. **Define Clear Policy**
   - Choose between: Always deny, Always allow, or Smart deny
   - Document policy clearly in design
   - Apply consistently in all cases

2. **Remove Automatic claudemem Execution**
   - Don't call `claudemem map` automatically
   - Just provide context/suggestion to use detective agent
   - Let user decide when to run analysis

3. **Add Error Handling for Map**
   - If keeping map calls (not recommended), add timeout handling
   - Show error message if map fails
   - Consider making it optional with flag

### Medium Priority (Should Fix)

4. **Improve Keyword Extraction**
   - Simplify or remove automatic keyword extraction
   - Let claudemem handle query parsing
   - Or use smarter extraction algorithm

5. **Add Type Guards**
   - Replace type assertions with proper type guards
   - Validate runtime structure before accessing properties

6. **Document Edge Cases**
   - What happens if tool_input is malformed?
   - What happens if claudemem is not installed?
   - What happens with very long prompts?

### Low Priority (Nice to Have)

7. **Add Configuration Options**
   - Environment variable to disable interception
   - User preference for strict vs. permissive mode

8. **Performance Optimization**
   - Cache recent map results
   - Debounce multiple Explore calls

9. **Enhanced Agent Selection**
   - Suggest different detective agents based on query type
   - architect-detective for architecture questions
   - debugger-detective for bugs/issues
   - etc.

---

## 6. Revised Design Suggestion

Here's a simpler, safer version addressing the critical issues:

```typescript
async function handleTaskIntercept(input: HookInput): Promise<HookOutput | null> {
  const toolInput = input.tool_input as {
    subagent_type?: string;
    prompt?: string;
    description?: string;
  } | undefined;

  if (!toolInput) return null;

  const subagentType = toolInput.subagent_type;

  // Only intercept the built-in Explore agent
  if (!subagentType || subagentType.toLowerCase() !== "explore") {
    return null;
  }

  // Always deny Explore when indexed - strong enforcement
  const status = isIndexed(input.cwd);
  if (!status.indexed) {
    return {
      additionalContext: `**Explore agent detected**

For structural code navigation with PageRank ranking, run:
\`\`\`bash
claudemem index
\`\`\`

Then use \`code-analysis:detective\` agent for AST-based analysis.`,
    };
  }

  // Extract context for helpful message
  const prompt = toolInput.prompt || toolInput.description || "your search query";

  return {
    additionalContext: `**Explore agent intercepted** - Use \`code-analysis:detective\` instead.

The code-analysis plugin provides AST-based structural analysis with PageRank ranking,
which is more effective than the built-in Explore agent's grep/find approach.

**How to use code-analysis:detective:**

\`\`\`typescript
Task({
  subagent_type: "code-analysis:detective",
  prompt: "${escapeForTemplate(prompt)}",
  description: "Investigate codebase structure"
})
\`\`\`

**Available detective agents:**
- \`code-analysis:detective\` - General code investigation
- \`code-analysis:developer-detective\` - Implementation details
- \`code-analysis:architect-detective\` - Architecture analysis
- \`code-analysis:debugger-detective\` - Bug investigation
- \`code-analysis:tester-detective\` - Test coverage`,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Explore agent replaced with code-analysis:detective for AST structural analysis.",
    },
  };
}
```

**Key Changes**:
1. Removed automatic `claudemem map` execution
2. Consistent policy: Always deny when indexed
3. Clearer error messages
4. Added suggestions for different detective agents
5. Simpler logic, easier to maintain

---

## Final Verdict

**Recommended**: **Proceed with modifications**

The core idea is sound and addresses a real gap in the plugin's capabilities. However, **the automatic claudemem execution and inconsistent denial policy must be fixed** before implementation. The revised design above provides a safer, more predictable approach that maintains the benefits while avoiding the pitfalls.

**Next Steps**:
1. Revise design with the recommendations above
2. Add detailed test cases with expected outputs
3. Consider adding environment variable for opt-out
4. Implement and test with real projects

The code-analysis plugin is already excellent at intercepting search tools - extending it to Task/Explore is a natural evolution, but requires careful attention to UX consistency.

---

*Generated by: z-ai/glm-4.7 via Claudish*
