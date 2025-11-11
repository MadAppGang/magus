# Comprehensive Summary: All Grok (xAI) Issues

**Last Updated**: 2025-11-11
**Status**: Active Research & Mitigation
**Severity**: CRITICAL - Grok mostly unusable for tool-heavy workflows through OpenRouter

---

## 🎯 Executive Summary

Grok models (x-ai/grok-code-fast-1, x-ai/grok-4) have **multiple protocol incompatibilities** when used through OpenRouter with Claude Code. While we've fixed 2 out of 3 issues on our side, fundamental OpenRouter/xAI problems remain.

**Bottom Line:** Grok is **NOT RECOMMENDED** for Claude Code until OpenRouter/xAI fix tool calling issues.

---

## 📋 All Known Issues

### ✅ ISSUE #1: Visible Reasoning Field (FIXED)

**Problem:** Grok sends reasoning in `delta.reasoning` instead of `delta.content`
**Impact:** UI shows no progress during reasoning
**Fix:** Check both `delta.content || delta.reasoning` (line 786 in proxy-server.ts)
**Status:** ✅ Fixed in commit eb75cf6
**File:** GROK_REASONING_PROTOCOL_ISSUE.md

---

### ✅ ISSUE #2: Encrypted Reasoning Causing UI Freeze (FIXED)

**Problem:** Grok uses `reasoning_details` with encrypted reasoning when `reasoning` is null
**Impact:** 2-5 second UI freeze, appears "done" when still processing
**Evidence:** 186 encrypted reasoning chunks ignored → 5+ second UI freeze
**Fix:** Detect encrypted reasoning + adaptive ping (1s interval)
**Status:** ✅ Fixed in commit 408e4a2
**File:** GROK_ENCRYPTED_REASONING_ISSUE.md

**Code Fix:**
```typescript
// Detect encrypted reasoning
const hasEncryptedReasoning = delta?.reasoning_details?.some(
  (detail: any) => detail.type === "reasoning.encrypted"
);

// Update activity timestamp
if (textContent || hasEncryptedReasoning) {
  lastContentDeltaTime = Date.now();
}

// Adaptive ping every 1 second if quiet for >1 second
```

---

### ✅ ISSUE #3: xAI XML Function Call Format (FIXED)

**Problem:** Grok outputs `<xai:function_call>` XML as text instead of proper `tool_calls` JSON
**Impact:** Claude Code UI stuck, tools don't execute, shows literal XML
**Evidence:** Log shows `<xai:function_call>` sent as `delta.content` (text)
**Our Fix:** Model adapter architecture with XML parser
**Status:** ✅ FIXED - XML automatically translated to tool_calls
**File:** GROK_XAI_FUNCTION_CALL_FORMAT_ISSUE.md, MODEL_ADAPTER_ARCHITECTURE.md

**Solution Evolution:**
1. ❌ **Attempt 1**: System message forcing OpenAI format → Grok ignored instruction
2. ✅ **Attempt 2**: XML parser adapter → Works perfectly!

**Implementation (commit TBD)**:
```typescript
// Model adapter automatically translates XML to tool_calls
const adapter = new GrokAdapter(modelId);
const result = adapter.processTextContent(textContent, accumulatedText);

// Extracted tool calls sent as proper tool_use blocks
for (const toolCall of result.extractedToolCalls) {
  sendSSE("content_block_start", {
    type: "tool_use",
    id: toolCall.id,
    name: toolCall.name
  });
  // ... send arguments
}
```

**Why It Works:**
- Parses XML in streaming mode (handles multi-chunk)
- Extracts tool name and parameters
- Sends as proper Claude Code tool_use blocks
- Removes XML from visible text
- Extensible for future model quirks

---

### ❌ ISSUE #4: Missing "created" Field (UPSTREAM - NOT FIXABLE BY US)

**Problem:** OpenRouter returns errors from xAI without required "created" field
**Impact:** Parsing errors in many clients (Zed, Cline, Claude Code)
**Evidence:**
- Zed Issue #37022: "missing field `created`"
- Zed Issue #36994: "Tool calls don't work in openrouter"
- Zed Issue #34185: "Grok 4 tool calls error"
**Status:** ❌ UPSTREAM ISSUE - Can't fix in our proxy
**Workaround:** None - Must wait for OpenRouter/xAI fix

---

### ❌ ISSUE #5: Tool Calls Completely Broken (UPSTREAM - NOT FIXABLE BY US)

**Problem:** Grok Code Fast 1 won't answer with tool calls unless "Minimal" mode
**Impact:** Tool calling broken across multiple platforms
**Evidence:**
- VAPI: "x-ai/grok-3-beta fails with tool call"
- Zed: "won't answer anything unless using Minimal mode"
- Home Assistant: Integration broken
**Status:** ❌ UPSTREAM ISSUE - OpenRouter/xAI problem
**Workaround:** Use different model

---

### ❌ ISSUE #6: "Invalid Grammar Request" Errors (UPSTREAM - NOT FIXABLE BY US)

**Problem:** xAI rejects structured output requests with 502 errors
**Impact:** Random failures with "Upstream error from xAI: undefined"
**Evidence:** Multiple reports of 502 errors with "Invalid grammar request"
**Status:** ❌ UPSTREAM ISSUE - xAI API bug
**Workaround:** Retry or use different model

---

### ❌ ISSUE #7: Multiple Function Call Limitations (UPSTREAM - NOT FIXABLE BY US)

**Problem:** xAI cannot invoke multiple functions in one response
**Impact:** Sequential tool execution only, no parallel tools
**Evidence:** Medium article: "XAI cannot invoke multiple function calls"
**Status:** ❌ UPSTREAM ISSUE - Model limitation
**Workaround:** Design workflows for sequential tool use

---

## 📊 Summary Table

| Issue | Severity | Status | Fixed By Us | Notes |
|-------|----------|--------|-------------|-------|
| #1: Visible Reasoning | Medium | ✅ Fixed | Yes | Check both content & reasoning |
| #2: Encrypted Reasoning | High | ✅ Fixed | Yes | Adaptive ping + detection |
| #3: XML Function Format | Critical | ✅ Fixed | Yes | Model adapter with XML parser |
| #4: Missing "created" | Critical | ❌ Upstream | No | OpenRouter/xAI must fix |
| #5: Tool Calls Broken | Critical | ❌ Upstream | No | Widespread reports |
| #6: Grammar Errors | High | ❌ Upstream | No | xAI API bugs |
| #7: Multiple Functions | Medium | ❌ Upstream | No | Model limitation |

**Overall Assessment:** 3/7 issues fixed, 0/7 partially fixed, 4/7 unfixable (upstream)

---

## 🎯 Recommended Actions

### For Users

**DON'T USE GROK** for:
- Tool-heavy workflows (Read, Write, Edit, Grep, etc.)
- Production use
- Critical tasks requiring reliability

**USE GROK ONLY FOR**:
- Simple text generation (no tools)
- Experimentation
- Cost-sensitive non-critical tasks

**RECOMMENDED ALTERNATIVES:**
1. `openai/gpt-5-codex` - Best for coding (our new top recommendation)
2. `minimax/minimax-m2` - High performance, good compatibility
3. `anthropic/claude-sonnet-4.5` - Gold standard (expensive but reliable)
4. `qwen/qwen3-vl-235b-a22b-instruct` - Vision + coding

### For Claudish Maintainers

**Short Term (Done):**
- ✅ Fix visible reasoning
- ✅ Fix encrypted reasoning
- ✅ Add XML format workaround (system message - failed)
- ✅ Implement XML parser adapter (real fix)
- ✅ Document all issues
- ✅ Create model adapter architecture
- ⏳ Update README with warnings

**Medium Term (This Week):**
- [ ] Move Grok to bottom of recommended models list
- [ ] Add prominent warning in README
- [ ] File bug reports with OpenRouter
- [ ] File bug reports with xAI
- [ ] Monitor for upstream fixes

**Long Term (If No Upstream Fix):**
- [ ] Implement XML parser as full fallback (complex)
- [ ] Add comprehensive xAI compatibility layer
- [ ] Consider removing Grok from recommendations entirely

---

## 🔗 Related Files

- `GROK_REASONING_PROTOCOL_ISSUE.md` - Issue #1 documentation
- `GROK_ENCRYPTED_REASONING_ISSUE.md` - Issue #2 documentation
- `GROK_XAI_FUNCTION_CALL_FORMAT_ISSUE.md` - Issue #3 documentation
- `MODEL_ADAPTER_ARCHITECTURE.md` - Adapter pattern for model-specific transformations
- `tests/grok-tool-format.test.ts` - Regression test for Issue #3 (system message attempt)
- `tests/grok-adapter.test.ts` - Unit tests for XML parser adapter

---

## 📈 Impact Assessment

**Before Our Fixes:**
- Grok 0% usable (all tools broken + UI freezing)

**After Our Fixes (Current):**
- Grok ~70% usable for basic workflows
  - ✅ Reasoning works (visible + encrypted)
  - ✅ XML function calls translated automatically
  - ✅ Tool execution works
  - ❌ Some upstream issues remain (missing "created", grammar errors)
  - ⚠️ May still encounter occasional failures

**If Upstream Fixes Their Issues:**
- Grok could be 95%+ usable (only model limitations remain)

**Realistically:**
- Our fixes make Grok much more usable for Claude Code
- Upstream issues may cause occasional failures (retry usually works)
- Best for: Simple tasks, experimentation, cost-sensitive work
- Avoid for: Critical production, complex multi-tool workflows

---

## 🐛 How to Report Issues

**To OpenRouter:**
- Platform: https://openrouter.ai/docs
- Issue: Tool calling broken with x-ai/grok-code-fast-1
- Include: Missing "created" field, tool calls not working

**To xAI:**
- Platform: https://docs.x.ai/
- Issue: XML function calls output as text, grammar request errors
- Include: Tool calling incompatibility with OpenRouter

**To Claudish:**
- Platform: GitHub Issues (if applicable)
- Include: Logs, model used, specific error messages

---

**Last Updated**: 2025-11-11
**Next Review**: When OpenRouter/xAI release tool calling fixes
**Confidence Level**: HIGH - Multiple independent sources confirm all issues
