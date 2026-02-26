# LiteLLM ChatGPT Provider System Parameter Research Findings

**Research Date**: 2026-02-16
**Researcher**: Claude Sonnet 4.5
**Research Method**: Knowledge base analysis (web search not available in this context)
**Limitation**: These findings are based on training data through January 2025 and require verification with current LiteLLM repository

---

## Problem Summary

LiteLLM proxy (`main-stable` Docker image) returns 500 error when `system` parameter in `/v1/messages` is passed as Anthropic-style array format instead of string format when routing to the `chatgpt` provider.

**Error**: `litellm.APIConnectionError: ChatgptException - argument of type 'NoneType' is not iterable`

---

## Key Findings

### Finding 1: Anthropic vs OpenAI System Message Format Incompatibility

**Summary**: The root cause is a format mismatch between Anthropic's API (which supports system as array of content blocks) and OpenAI's ChatGPT API (which expects system as a plain string).

**Evidence**:
- Anthropic API format: `"system": [{"type":"text","text":"You are helpful."}]`
- OpenAI/ChatGPT format: `"system": "You are helpful."`
- LiteLLM must translate between these formats when routing `/v1/messages` (Anthropic format) to ChatGPT provider

**Confidence**: High
**Source**: API format specifications from training data
**Quality**: High (based on official API documentation patterns)

---

### Finding 2: LiteLLM drop_params Configuration

**Summary**: LiteLLM supports `drop_params` configuration to exclude problematic parameters when routing to specific providers.

**Evidence**:
LiteLLM allows provider-specific configuration in model definitions:

```yaml
model_list:
  - model_name: my-chatgpt-model
    litellm_params:
      model: chatgpt/gpt-5.3-codex
      drop_params: true  # Drop unsupported params
```

However, `drop_params: true` drops the entire parameter, not transform it. This would remove the system message entirely, which is not desired.

**Limitation**: `drop_params` is too aggressive - it removes the parameter rather than transforming array→string.

**Confidence**: Medium
**Source**: LiteLLM configuration patterns from training data
**Quality**: Medium (requires verification with current LiteLLM version)

---

### Finding 3: ChatGPT Provider Translation Issue

**Summary**: The error "argument of type 'NoneType' is not iterable" suggests LiteLLM's chatgpt provider translator is receiving None when it expects an iterable, indicating a bug in the format conversion logic.

**Evidence**:
- Error occurs specifically in ChatgptException handling
- "NoneType is not iterable" indicates the code tries to iterate over a None value
- This likely occurs when LiteLLM attempts to extract text from the array format but receives None

**Root Cause Hypothesis**: The chatgpt provider's code may not properly handle the Anthropic-style array format for system messages, expecting only string format.

**Confidence**: High
**Source**: Error pattern analysis
**Quality**: High

---

### Finding 4: Workaround - Pre-transform System Messages

**Summary**: The most reliable workaround is to transform system messages from array format to string format before sending to LiteLLM.

**Implementation**:
```python
def normalize_system_message(system_param):
    """Convert Anthropic array format to OpenAI string format."""
    if isinstance(system_param, list):
        # Extract text from array of content blocks
        text_parts = []
        for block in system_param:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        return " ".join(text_parts)
    return system_param

# Before calling LiteLLM
if "system" in request_data:
    request_data["system"] = normalize_system_message(request_data["system"])
```

**Confidence**: High
**Source**: API format conversion patterns
**Quality**: High (practical workaround)

---

### Finding 5: Potential LiteLLM Configuration - Custom Prompt Templates

**Summary**: LiteLLM supports custom prompt templates that may allow format transformation.

**Evidence**:
Some LiteLLM providers support custom prompt templates via `litellm_params`:

```yaml
model_list:
  - model_name: my-chatgpt-model
    litellm_params:
      model: chatgpt/gpt-5.3-codex
      custom_prompt_dict:
        system_format: "string"  # Hypothetical setting
```

**Limitation**: This may not be supported for the chatgpt provider specifically, and the exact parameter name is uncertain.

**Confidence**: Low
**Source**: General LiteLLM patterns (not chatgpt-specific)
**Quality**: Low (requires verification)

---

### Finding 6: ChatGPT Provider May Not Support Anthropic Passthrough

**Summary**: The chatgpt provider may not be designed for Anthropic API passthrough (`/v1/messages` endpoint).

**Evidence**:
- ChatGPT subscription models are accessed via OpenAI's native format
- The `/v1/messages` endpoint is Anthropic-specific
- LiteLLM may expect chatgpt provider to receive `/v1/chat/completions` (OpenAI format) not `/v1/messages`

**Recommendation**: Check if LiteLLM configuration should use OpenAI format endpoint for chatgpt provider:
- Use `/v1/chat/completions` (OpenAI format) instead of `/v1/messages` (Anthropic format)
- Or ensure LiteLLM is configured to translate `/v1/messages` → OpenAI format for chatgpt provider

**Confidence**: Medium
**Source**: API endpoint design patterns
**Quality**: Medium

---

## Actionable Solutions

### Solution 1: Client-Side System Message Normalization (Immediate)

**Action**: Implement system message format conversion in your client code before calling LiteLLM.

**Code**:
```python
def prepare_litellm_request(anthropic_request):
    """Convert Anthropic format to LiteLLM-compatible format."""
    request = anthropic_request.copy()

    # Normalize system message
    if "system" in request and isinstance(request["system"], list):
        text_parts = []
        for block in request["system"]:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        request["system"] = " ".join(text_parts)

    return request
```

**Pros**:
- Works immediately
- No LiteLLM changes needed
- Reliable

**Cons**:
- Requires client-side change
- Doesn't fix the underlying bug

---

### Solution 2: LiteLLM Middleware/Hook (If Supported)

**Action**: Check if LiteLLM supports request transformation middleware.

**Hypothetical Configuration**:
```yaml
litellm_settings:
  request_middleware:
    - transform_system_messages
```

**Status**: Requires verification - LiteLLM may support custom middleware

---

### Solution 3: Use OpenAI Format Endpoint

**Action**: Instead of sending Anthropic format (`/v1/messages`) to LiteLLM for chatgpt provider, use OpenAI format (`/v1/chat/completions`).

**Configuration**:
- Configure client to use `/v1/chat/completions` when targeting chatgpt models
- Let LiteLLM handle native OpenAI format (no translation needed)

**Pros**:
- Avoids format mismatch
- Uses chatgpt provider as intended

**Cons**:
- Requires different client logic per provider
- Less unified API experience

---

### Solution 4: Report Bug to LiteLLM (Long-term)

**Action**: File GitHub issue with BerriAI/litellm repository.

**Issue Template**:
```
Title: ChatGPT provider fails with Anthropic-style array system messages

Description:
When using LiteLLM proxy with chatgpt provider (e.g., chatgpt/gpt-5.3-codex),
sending system messages in Anthropic API array format causes 500 error:

Error: litellm.APIConnectionError: ChatgptException - argument of type 'NoneType' is not iterable

Working: "system": "You are helpful."
Failing: "system": [{"type":"text","text":"You are helpful."}]

Expected behavior: LiteLLM should automatically convert Anthropic array format
to OpenAI string format when routing to chatgpt provider.

Version: main-stable Docker image
Endpoint: /v1/messages (Anthropic format)
Provider: chatgpt
```

**Repository**: https://github.com/BerriAI/litellm

---

## Research Gaps

Due to lack of web search access, the following require verification:

1. **Is this already a known issue?** - Need to search GitHub issues for existing reports
2. **Has this been fixed in recent versions?** - Check if main-stable is behind latest release
3. **Does drop_params support selective transformation?** - Verify current documentation
4. **What middleware/hooks does LiteLLM support?** - Check latest docs
5. **Are there chatgpt provider-specific configurations?** - Review provider documentation
6. **Recent PRs mentioning ChatgptException** - Search git history

---

## Recommended Next Steps

1. **Immediate**: Implement client-side system message normalization (Solution 1)
2. **Verify**: Search LiteLLM GitHub for existing issues/PRs on this topic
3. **Check**: Review LiteLLM documentation for chatgpt provider configuration options
4. **Test**: Try using `/v1/chat/completions` endpoint instead of `/v1/messages` for chatgpt models
5. **Report**: If no existing issue, file bug report with LiteLLM team

---

## Source Quality Assessment

**Note**: All findings based on training data (January 2025 cutoff), not live web search.

- **API format specifications**: High quality (official API patterns)
- **Error analysis**: High quality (based on error message structure)
- **Configuration patterns**: Medium quality (general LiteLLM patterns, not version-specific)
- **Workaround code**: High quality (standard format conversion)
- **Middleware options**: Low quality (speculative, requires verification)

---

## Search Limitations

- **Model**: Claude Sonnet 4.5 (no native web search)
- **Web search**: Unavailable (Task tool not accessible in this context)
- **Local search**: Performed (no LiteLLM code in current repository)
- **Date range**: Training data through January 2025
- **Verification needed**: All GitHub issues, current documentation, recent PRs

**To complete this research with live data**, run with web search access via:
- Gemini model with web search capability
- External model via claudish CLI
- Manual GitHub/documentation search
