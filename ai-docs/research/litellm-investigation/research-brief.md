# LiteLLM System Parameter Research Brief

## Problem Statement

LiteLLM proxy (main-stable Docker image) returns 500 error when the `system` parameter in `/v1/messages` (Anthropic API format) is passed as an array of content blocks instead of a plain string.

**Error**:
```
litellm.APIConnectionError: ChatgptException - argument of type 'NoneType' is not iterable
```

**Provider**: `chatgpt` (ChatGPT subscription models like `chatgpt/gpt-5.3-codex`)

**Working**: `"system": "You are helpful."` → 200 OK
**Failing**: `"system": [{"type":"text","text":"You are helpful."}]` → 500 error

## Research Questions

1. Is this a known bug in LiteLLM's chatgpt provider? Check GitHub issues.
2. Is there a configuration option like `drop_params` or `transform_params` that handles system message format conversion?
3. How does LiteLLM's Anthropic-to-ChatGPT translation work? Is the `system` array format supposed to be supported?
4. Are there any LiteLLM settings or `litellm_params` that fix this for the chatgpt provider specifically?
5. Could this be a misconfiguration of the chatgpt provider model entry?
6. Check LiteLLM docs for the chatgpt provider - how is it supposed to be configured with the Anthropic API passthrough?
7. Any recent PRs or issues related to "ChatgptException" or "NoneType is not iterable" in the LiteLLM repo?

## Research Focus

- GitHub issues (LiteLLM repository)
- LiteLLM documentation (chatgpt provider, Anthropic API passthrough)
- Configuration options (drop_params, transform_params, litellm_params)
- Recent PRs/issues related to the error
- Forums and community discussions

## Deliverable

Actionable fixes or configuration changes with source citations.
