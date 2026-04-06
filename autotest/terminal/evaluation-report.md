# Terminal Plugin E2E Test Suite Evaluation

## 1. Real MCP Tool Behavior
While the test runner (`autotest/framework/runner-base.sh`) does spawn the actual `claude` process with the terminal plugin loaded (which in turn uses the real `tmux-mcp` Go binary), the tests do not verify real behavior in a rigorous way. The test framework itself never performs out-of-band (host-side) validation. For example, it never independently checks if a tmux session was created, or if `/tmp/vim-e2e-test.txt` actually exists on the filesystem. It relies entirely on the LLM's own claims about what happened.

## 2. Test Coverage Gaps
- **No Host-Side Verification:** There is zero independent verification. A test framework should use separate scripts to assert that the environment state changed correctly (e.g., `tmux ls` run by the test runner).
- **No Tool Result Verification:** The analyzer checks if a tool was *called*, but it completely ignores the *result* of that tool call. It does not verify whether the MCP server returned success or an error string.

## 3. Test Reliability (Gaming the System)
The tests are highly susceptible to being "gamed" by the LLM and could easily pass even if the MCP tools are broken. 
Because the prompts explicitly tell the model what string to output (e.g., `"Your response must include the text: WATCH_PANE_SIGNAL_22222"`), the model is heavily incentivized to just echo that marker. If the `tmux-mcp` tool fails and returns an error, the model might simply apologize for the error but still output the requested marker text to follow instructions. The analyzer will see that the tool was called and the marker is in the response, resulting in a false `PASS`.

## 4. Prompt Quality
The test prompts are heavily leading and "leak" the expected answers, which destroys the validity of an E2E test for an autonomous agent. 
- Example from `run-in-repl-python-06`: `"Report both results. The correct answers are 385 and 1024."` The model doesn't even need to use the REPL; it can just regurgitate the provided answers.
- Example from `no-truncation-100-lines-13`: `"IMPORTANT: The output must NOT be truncated. Report NOTRUNC_LINE_1 and NOTRUNC_LINE_100 in your response."`

## 5. System Effectiveness (Analyzer)
The analyzer (`autotest/terminal/analyze-results.ts`) is insufficient:
- `has_tool_prefix`, `min_tool_calls`, `tool_arg_match` only check the tool *invocation*. They do not verify the tool *execution result*.
- `response_contains` only checks the LLM's final text output.
Combined with the leading prompts, these checks allow models to pass by simply hallucinating success after a tool failure.

```vote
VERDICT: REJECT
CONFIDENCE: 10
SUMMARY: The tests are superficial and easily gamed because they leak the exact expected outputs in the prompts and fail to verify either the tool execution results or the actual host system state.
KEY_ISSUES: Leaked answers in prompts, No host-side state verification, Analyzer ignores tool execution results (errors), Model can pass tests despite tool failures by simply echoing requested markers.
```
