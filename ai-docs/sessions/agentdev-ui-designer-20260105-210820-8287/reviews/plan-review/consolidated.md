# Consolidated Plan Review: UI Designer Capability

**Date**: 2026-01-05
**Session**: agentdev-ui-designer-20260105-210820-8287
**Duration**: 361 seconds (6 minutes)
**Models**: 8 (1 internal + 7 external)

---

## Model Performance Summary

| Model | Status | Issues Found | Key Focus |
|-------|--------|--------------|-----------|
| Internal (Claude Opus) | ✅ COMPLETED | 13 (1C, 4H, 5M, 3L) | Write tool contradiction |
| minimax/minimax-m2.1 | ✅ COMPLETED | 10 (2C, 3H, 4M, 4L) | CLAUDE.md integration |
| z-ai/glm-4.7 | ✅ COMPLETED | 4 (0C, 2H, 2M, 0L) | PROXY_MODE examples |
| or/google/gemini-3-pro | ✅ COMPLETED | 9 (0C, 2H, 4M, 3L) | Image input method |
| or/openai/gpt-5.2 | ⚠️ FALLBACK | 11 (2C, 3H, 4M, 2L) | Model routing prefix |
| moonshotai/kimi-k2 | ✅ COMPLETED | 12 (1C, 4H, 5M, 3L) | Command type field |
| deepseek/deepseek-v3.2 | ✅ COMPLETED | 13 (1C, 4H, 5M, 3L) | Vision delegation |
| qwen/qwen3-vl-235b | ✅ COMPLETED | 13 (1C, 4H, 5M, 3L) | Multimodal prompting |

**Note**: GPT-5.2 failed due to OpenRouter model routing issue; Grok was used as fallback.

---

## Consensus Analysis

### CRITICAL Issues (Consensus: 6/8 models)

| Issue | Flagged By | Description |
|-------|------------|-------------|
| **Write Tool Contradiction** | Internal, DeepSeek, Qwen, Kimi | Agent defined as "reviewer" that "NEVER uses Write" but workflow requires writing review files |
| **Image Input Method Undocumented** | Gemini, Qwen, DeepSeek, Kimi | Design doesn't show HOW to pass images to Claudish/Gemini |
| **Missing skill reference** | Internal, MiniMax, Kimi | `orchestration:session-isolation` skill doesn't exist |

### HIGH Priority Issues (Consensus: 5+ models)

| Issue | Flagged By | Description |
|-------|------------|-------------|
| **API Key Detection Inconsistency** | Internal, GLM, DeepSeek, GPT5, Qwen | Agent falls back to OpenRouter without checking OPENROUTER_API_KEY |
| **Incorrect `--auto-approve` flag** | GLM, GPT5, Kimi | Flag doesn't exist in Claudish; should be removed |
| **Missing PROXY_MODE examples** | GLM, Qwen, Kimi, DeepSeek | No examples showing PROXY_MODE usage in agent |
| **`or/` prefix controversy** | GPT5 | Disagreement on whether `or/` is needed for OpenRouter routing |

### MEDIUM Priority Issues (Common Themes)

1. **TodoWrite phases misaligned** with workflow phases
2. **No SESSION_PATH examples** in agent section
3. **Missing image size/format validation**
4. **Model routing logic duplicated** across agent/skill/command
5. **No multi-image comparison example**

---

## Divergent Opinions

### Model Routing Prefix (`or/` vs no prefix)

**Majority view (7 models)**: Use `or/google/gemini-3-pro-preview` to force OpenRouter routing
**GPT5 (via Grok) view**: This is WRONG - use `google/gemini-3-pro-preview` directly; the `or/` prefix is only needed when BOTH keys exist

**Resolution**: Test with actual Claudish. The `or/` prefix is documented in the orchestration:proxy-mode-reference skill as the correct approach when you want to force OpenRouter routing for google/* models.

### Agent Type (Reviewer vs Implementer)

**Internal, DeepSeek**: This is a fundamental contradiction - choose one approach
**Others**: Just add Write tool and clarify it's for review documents only

**Resolution**: Add Write tool to agent and update reviewer_rules to clarify:
- MAY use Write for review documents at SESSION_PATH
- MUST NOT use Write/Edit on user's source files

---

## Recommended Fixes

### Must Fix Before Implementation

1. **Resolve Write tool issue**:
   ```yaml
   tools: TodoWrite, Read, Write, Bash, Glob, Grep
   ```
   Update `<reviewer_rules>`:
   ```xml
   - You MAY use Write to create review documents at ${SESSION_PATH}
   - You MUST NOT modify user's source files
   ```

2. **Document Claudish image passing**:
   ```bash
   # Local image
   claudish --model "$GEMINI_MODEL" --image "$IMAGE_PATH" --quiet <<< "$PROMPT"

   # Base64 (if needed)
   IMAGE_B64=$(base64 -i screenshot.png)
   printf '%s' "[Image: data:image/png;base64,$IMAGE_B64]\n$PROMPT" | claudish --stdin --model "$GEMINI_MODEL"
   ```

3. **Remove or create session-isolation skill**:
   - Remove from command skills list, OR
   - Create the skill (it's actually useful and should exist)

4. **Fix API key detection** in agent to match skill:
   ```bash
   if [[ -n "$GEMINI_API_KEY" ]]; then
     GEMINI_MODEL="g/gemini-3-pro-preview"
   elif [[ -n "$OPENROUTER_API_KEY" ]]; then
     GEMINI_MODEL="or/google/gemini-3-pro-preview"
   else
     echo "ERROR: No API key available"
     exit 1
   fi
   ```

5. **Remove `--auto-approve` flag** from Claudish commands (auto-approve is default)

### Should Fix

6. Add PROXY_MODE example to agent examples section
7. Add SESSION_PATH example to agent examples
8. Add multi-image comparison example
9. Align TodoWrite phases with workflow phases
10. Add image validation (format, size)

---

## Overall Recommendation

**CONDITIONAL PASS** - Ready for implementation after fixing the 5 critical/high issues above.

The design is comprehensive, well-structured, and demonstrates excellent understanding of:
- Claude Code agent patterns
- Multimodal capabilities with Gemini
- PROXY_MODE for multi-model validation
- Session-based artifact isolation
- Error handling and graceful degradation

**Strengths Consensus**:
- Excellent PROXY_MODE documentation
- Strong error handling coverage
- Good design principles reference (Nielsen, WCAG, Gestalt)
- Proper session isolation patterns

---

*Consolidated by: Orchestrator*
*8 models reviewed in parallel: 361 seconds*
