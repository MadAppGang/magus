# Design: PROXY_MODE Support Fix for Dev Plugin Agents

**Session**: agentdev-dev-proxy-mode-20260109-000514-b590
**Date**: 2026-01-09
**Status**: DESIGN COMPLETE

---

## Executive Summary

The dev plugin agents have PROXY_MODE instructions in their prompts, but several agents lack the `Bash` tool required to execute the `npx claudish` delegation command. This design document outlines:
1. Which agents need PROXY_MODE support and why
2. Exact changes needed for each agent
3. Implementation order and testing approach

---

## Problem Analysis

### Current State

| Agent | Has Bash | Has PROXY_MODE Instructions | Status |
|-------|----------|----------------------------|--------|
| researcher.md | YES | YES | WORKING |
| developer.md | YES | YES | WORKING |
| debugger.md | YES | YES | WORKING |
| devops.md | YES | YES | WORKING |
| test-architect.md | YES | NO | NEEDS PROXY_MODE BLOCK |
| ui.md | YES | YES | WORKING |
| stack-detector.md | YES | NO | NO FIX NEEDED |
| scribe.md | YES | NO | NO FIX NEEDED |
| architect.md | NO | YES | BROKEN - NEEDS BASH |
| synthesizer.md | NO | NO | BROKEN - NEEDS BOTH |
| spec-writer.md | NO | NO | NO FIX NEEDED |

### Root Cause

Agents with PROXY_MODE instructions but without Bash tool cannot execute the claudish delegation command:
```bash
printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve
```

---

## Agent Classification

### Category 1: WORKING (No Changes Needed)
These agents have both Bash and complete PROXY_MODE support:

1. **researcher.md** - Has Bash, has full PROXY_MODE block
2. **developer.md** - Has Bash, has full PROXY_MODE block
3. **debugger.md** - Has Bash, has full PROXY_MODE block
4. **devops.md** - Has Bash, has full PROXY_MODE block
5. **ui.md** - Has Bash, has full PROXY_MODE block with error handling and prefix collision awareness

### Category 2: NEEDS FIX (Missing Bash)
These agents have PROXY_MODE instructions but no Bash tool:

1. **architect.md** - Has PROXY_MODE block but NO Bash in tools list
   - **Fix**: Add Bash to tools list
   - **Priority**: HIGH (used in multi-model validation)

### Category 3: SHOULD ADD PROXY_MODE
These agents have Bash but no PROXY_MODE support:

1. **test-architect.md** - Has Bash, should support multi-model test design validation
   - **Fix**: Add PROXY_MODE block
   - **Priority**: MEDIUM (useful for multi-perspective test design)

### Category 4: NO PROXY_MODE NEEDED
These agents intentionally don't need PROXY_MODE:

1. **synthesizer.md** - Internal synthesis agent for research workflow
   - Does NOT need Bash or PROXY_MODE
   - Role is to consolidate LOCAL findings, not delegate to external models
   - Adding Bash would expand scope beyond design intent
   - **Decision**: NO FIX - Keep as-is

2. **spec-writer.md** - Internal spec synthesis agent
   - Does NOT need Bash or PROXY_MODE
   - Role is to synthesize interview sessions locally
   - Intentionally restricted tool set (Read, Write, Glob, Grep)
   - **Decision**: NO FIX - Keep as-is

3. **stack-detector.md** - Utility agent for stack detection
   - Has Bash for running detection commands
   - NOT a validation/review agent - no multi-model value
   - **Decision**: NO FIX - Keep as-is

4. **scribe.md** - Lightweight haiku file writer
   - Uses haiku model (fastest/cheapest)
   - Simple file operations only
   - NOT suitable for multi-model validation
   - **Decision**: NO FIX - Keep as-is

---

## Detailed Fix Specifications

### Fix 1: architect.md - Add Bash Tool

**File**: `/Users/jack/mag/claude-code/plugins/dev/agents/architect.md`

**Current**:
```yaml
tools: TodoWrite, Read, Write, Glob, Grep
```

**Change to**:
```yaml
tools: TodoWrite, Read, Write, Bash, Glob, Grep
```

**Rationale**: The architect agent already has a complete PROXY_MODE block in its instructions but cannot execute it without Bash. This is a simple one-line fix.

---

### Fix 2: test-architect.md - Add PROXY_MODE Block

**File**: `/Users/jack/mag/claude-code/plugins/dev/agents/test-architect.md`

**Location**: Add after `<todowrite_requirement>` section, before `<test_authority>` section

**Add this block**:
```xml
<proxy_mode_support>
  **FIRST STEP: Check for Proxy Mode Directive**

  If prompt starts with `PROXY_MODE: {model_name}`:
  1. Extract model name and actual task
  2. Delegate via Claudish: `printf '%s' "$PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve`
  3. Return attributed response and STOP

  **If NO PROXY_MODE**: Proceed with normal workflow

  <error_handling>
    **CRITICAL: Never Silently Substitute Models**

    When PROXY_MODE execution fails:

    1. **DO NOT** fall back to another model silently
    2. **DO NOT** use internal Claude to complete the task
    3. **DO** report the failure with details
    4. **DO** return to orchestrator for decision

    **Error Report Format:**
    ```markdown
    ## PROXY_MODE Failed

    **Requested Model:** {model_id}
    **Detected Backend:** {backend from prefix}
    **Error:** {error_message}

    **Possible Causes:**
    - Missing API key for {backend} backend
    - Model not available on {backend}
    - Prefix collision (try using `or/` prefix for OpenRouter)
    - Network/API error

    **Task NOT Completed.**

    Please check the model ID and try again, or select a different model.
    ```

    **Why This Matters:**
    - Silent fallback corrupts multi-model validation results
    - User expects specific model's perspective, not a substitute
    - Orchestrator cannot make informed decisions without failure info
  </error_handling>

  <prefix_collision_awareness>
    Before executing PROXY_MODE, check for prefix collisions:

    **Colliding Prefixes:**
    - `google/` routes to Gemini Direct (needs GEMINI_API_KEY)
    - `openai/` routes to OpenAI Direct (needs OPENAI_API_KEY)
    - `g/` routes to Gemini Direct
    - `oai/` routes to OpenAI Direct

    **If model ID starts with colliding prefix:**
    1. Check if user likely wanted OpenRouter
    2. If unclear, note in error report: "Model ID may have prefix collision"
    3. Suggest using `or/` prefix for OpenRouter routing
  </prefix_collision_awareness>
</proxy_mode_support>
```

**Rationale**: Test design benefits from multi-perspective validation. Different models may suggest different test scenarios, edge cases, or testing strategies. The test-architect already has Bash for running tests, so adding PROXY_MODE is safe.

---

## Why NOT to Add PROXY_MODE to Others

### synthesizer.md - Keep As-Is

**Current Purpose**: Consolidate findings from MULTIPLE local research agents into a coherent synthesis.

**Why No PROXY_MODE**:
1. The synthesizer reads LOCAL files (${SESSION_PATH}/findings/*.md)
2. It calculates quality metrics from LOCAL data
3. External model delegation would break the file-based communication pattern
4. Adding Bash would allow arbitrary commands - scope creep

**Alternative Architecture** (if multi-model synthesis needed):
- The orchestrator (deep-research command) would run multiple synthesizers in parallel via Task tool
- Each synthesizer runs locally but the ORCHESTRATOR handles model diversity
- This is the correct pattern for multi-model validation

### spec-writer.md - Keep As-Is

**Current Purpose**: Transform interview session content into specification documents.

**Why No PROXY_MODE**:
1. Internal agent called by interview command
2. Reads interview-log.md, assets.md, context.json - all LOCAL
3. Writes spec.md, tasks.md - LOCAL outputs
4. Uses `allowed-tools` not `tools` - intentionally restricted
5. No value in multi-model spec synthesis

### stack-detector.md - Keep As-Is

**Current Purpose**: Detect project technology stack and recommend skills.

**Why No PROXY_MODE**:
1. Deterministic detection (find package.json, go.mod, etc.)
2. No opinion-based analysis where model diversity adds value
3. Uses Bash only for file system commands (ls, grep)
4. Output is structured JSON - no synthesis benefit

### scribe.md - Keep As-Is

**Current Purpose**: Fast, lightweight file writer for interview sessions.

**Why No PROXY_MODE**:
1. Uses haiku model (cheapest/fastest) intentionally
2. Simple append/write operations
3. Speed is critical for interview flow
4. No analysis or opinion - just formatting

---

## PROXY_MODE Block Comparison

### Minimal Version (researcher, developer, debugger, devops)
```xml
<proxy_mode_support>
  **FIRST STEP: Check for Proxy Mode Directive**

  Before executing, check if the incoming prompt starts with:
  ```
  PROXY_MODE: {model_name}
  ```

  If you see this directive:

  1. **Extract model name** (e.g., "x-ai/grok-code-fast-1")
  2. **Extract actual task** (everything after PROXY_MODE line)
  3. **Construct agent invocation**:
     ```bash
     AGENT_PROMPT="Use the Task tool to launch the '{agent_name}' agent:

{actual_task}"
     ```
  4. **Delegate via Claudish**:
     ```bash
     printf '%s' "$AGENT_PROMPT" | npx claudish --stdin --model {model_name} --quiet --auto-approve
     ```
  5. **Return attributed response**:
     ```markdown
     ## {Review Type} via External AI: {model_name}

     {EXTERNAL_AI_RESPONSE}

     ---
     *Generated by: {model_name} via Claudish*
     ```
  6. **STOP** - Do not execute locally

  **If NO PROXY_MODE directive**: Proceed with normal workflow

  <error_handling>
    **CRITICAL: Never Silently Substitute Models**

    When PROXY_MODE execution fails:
    1. DO NOT fall back to another model silently
    2. DO NOT use internal Claude to complete the task
    3. DO report the failure with details
    4. DO return to orchestrator for decision

    **Error Report Format:**
    ```markdown
    ## PROXY_MODE Failed

    **Requested Model:** {model_id}
    **Error:** {error_message}

    **Task NOT Completed.**

    Please check the model ID and try again, or select a different model.
    ```
  </error_handling>
</proxy_mode_support>
```

### Enhanced Version (agentdev:reviewer, agentdev:architect, agentdev:developer, ui)
Includes additional sections:
- `<error_handling>` with backend detection and possible causes
- `<prefix_collision_awareness>` for routing disambiguation

**Recommendation**: Use the enhanced version for all new PROXY_MODE additions for consistency with agentdev plugin standards.

---

## Implementation Order

### Priority 1: HIGH (Immediate)
1. **architect.md** - Add Bash to tools list
   - Simple one-line change
   - Unblocks multi-model architecture validation
   - Already has complete PROXY_MODE block

### Priority 2: MEDIUM (Next)
2. **test-architect.md** - Add PROXY_MODE block
   - Copy enhanced pattern from agentdev:reviewer
   - Already has Bash
   - Enables multi-model test design validation

---

## Implementation Steps

### Step 1: Fix architect.md (5 minutes)

```bash
# Line 7 in /Users/jack/mag/claude-code/plugins/dev/agents/architect.md
# Change from:
tools: TodoWrite, Read, Write, Glob, Grep

# To:
tools: TodoWrite, Read, Write, Bash, Glob, Grep
```

### Step 2: Fix test-architect.md (10 minutes)

Insert the PROXY_MODE block after line 64 (after `</todowrite_requirement>`), before line 66 (`<test_authority>`).

---

## Testing Approach

### Test 1: Verify Bash Execution
```bash
# For architect.md after fix
echo "PROXY_MODE: or/google/gemini-3-pro-preview

Design a simple user profile component for React." | claude --agent dev:architect
```

Expected: Should delegate to Gemini and return attributed response.

### Test 2: Verify Error Handling
```bash
# Test with invalid model
echo "PROXY_MODE: or/invalid-model-xyz

Design a user profile component." | claude --agent dev:architect
```

Expected: Should return PROXY_MODE Failed error report, NOT fall back silently.

### Test 3: Verify Normal Mode
```bash
# Test without PROXY_MODE
echo "Design a user profile component for React." | claude --agent dev:architect
```

Expected: Should execute normally using native Claude.

### Test 4: test-architect PROXY_MODE
```bash
# After adding PROXY_MODE block
echo "PROXY_MODE: x-ai/grok-code-fast-1

Create test plan for user authentication feature.
Requirements: email/password login, JWT tokens, rate limiting." | claude --agent dev:test-architect
```

Expected: Should delegate to Grok and return attributed response.

---

## Impact Assessment

### Agents Being Fixed: 2
1. architect.md (add Bash)
2. test-architect.md (add PROXY_MODE block)

### Agents Unchanged: 9
- researcher.md (working)
- developer.md (working)
- debugger.md (working)
- devops.md (working)
- ui.md (working)
- synthesizer.md (intentionally no PROXY_MODE)
- spec-writer.md (intentionally no PROXY_MODE)
- stack-detector.md (no multi-model value)
- scribe.md (lightweight/fast)

### Risk: LOW
- Adding Bash to architect is minimal risk (already has PROXY_MODE instructions)
- Adding PROXY_MODE to test-architect follows established pattern
- No changes to synthesizer/spec-writer preserves their intentional design

---

## Summary

| Fix | Agent | Change | Priority | Effort |
|-----|-------|--------|----------|--------|
| 1 | architect.md | Add Bash to tools | HIGH | 5 min |
| 2 | test-architect.md | Add PROXY_MODE block | MEDIUM | 10 min |

**Total Effort**: ~15 minutes

**Next Steps**:
1. Implement Fix 1 (architect.md)
2. Implement Fix 2 (test-architect.md)
3. Test both agents with PROXY_MODE
4. Verify normal mode still works

---

*Design document created by agent-architect*
*Ready for implementation with agentdev:developer*
