---
name: claudish-usage
description: Guide for using Claudish — both via MCP tools (preferred for orchestration) and CLI (for direct usage). In orchestration workflows (/team, /delegate), use claudish MCP tools (team, create_session) — not Bash+CLI. For direct user-facing tasks, the CLI remains the primary interface. Use when user mentions external AI models, Claudish, OpenRouter, or alternative models.
user-invocable: false
---

# Claudish Usage Skill

**Version:** 1.1.0
**Purpose:** Guide AI agents on how to use Claudish CLI to run Claude Code with OpenRouter models
**Status:** Production Ready

## Orchestration vs Direct Usage

### MCP Tools (for orchestration — /team, /delegate, multi-model workflows)

In orchestration workflows, use claudish MCP tools — NOT Bash+CLI:

- **`team` MCP tool** — run prompt across multiple models in parallel
- **`create_session` MCP tool** — start a single async session
- **`get_output`** — retrieve session output
- **`send_input`** — answer interactive questions
- **`report_error`** — report failures

MCP sessions run externally — no context window pollution.

### CLI (for direct user tasks)

For direct user-facing tasks outside orchestration workflows, the claudish CLI is the standard interface. See CLI sections below.

### Decision Tree

```
User Request
    ↓
Orchestration workflow (/team, /delegate, multi-model vote)? → YES → Use MCP tools
    ↓ NO
    ↓
Direct task (user says "use Grok to implement X")? → Use /delegate command (MCP-based)
    ↓
Direct CLI usage (user debugging, testing models)? → CLI is fine
```

## 🤖 Agent Selection Guide

### Step 1: Find the Right Agent

**When user requests Claudish task, follow this process:**

1. **Check for existing agents** that support proxy mode or external model delegation
2. **If no suitable agent exists:**
   - Suggest creating a new proxy-mode agent for this task type
   - Offer to proceed with generic `general-purpose` agent if user declines
3. **If user declines agent creation:**
   - Warn about context pollution
   - Ask if they want to proceed anyway

### Step 2: Agent Type Selection Matrix

> **Note:** In orchestration workflows, external models are invoked via claudish MCP tools (team, create_session).
> The agent is resolved by the orchestrator and set via Task tool for internal models. External models receive context through the vote prompt.

| Task Type | Recommended Agent | Alternatives | Notes |
|-----------|----------------------|--------------|-------|
| **Investigation** | `dev:researcher` | `code-analysis:detective` | For finding bugs, tracing issues |
| **Code review** | `agentdev:reviewer` | `frontend:reviewer` | Check if plugin has review agent |
| **Architecture** | `dev:architect` | `frontend:architect` | Design and planning tasks |
| **Implementation** | `dev:developer` | `frontend:developer` | Building features |
| **Testing** | `dev:test-architect` | — | Test strategy and coverage |
| **Debugging** | `dev:debugger` | — | Error analysis and tracing |
| **Documentation** | `dev:researcher` | — | Simple task, researcher works |
| **UI/Design** | `dev:ui` | `frontend:designer` | Visual and UX tasks |

### Step 3: Agent Creation Offer (When No Agent Exists)

**Template response:**
```
I notice you want to use [Model Name] for [task type].

RECOMMENDATION: Create a specialized [task type] agent with proxy mode support.

This would:
✅ Provide better task-specific guidance
✅ Reusable for future [task type] tasks
✅ Optimized prompting for [Model Name]

Options:
1. Create specialized agent (recommended) - takes 2-3 minutes
2. Use generic general-purpose agent - works but less optimized
3. Run directly in main context (NOT recommended - pollutes context)

Which would you prefer?
```

### Step 4: Common Agents by Plugin

**Frontend Plugin:**
- `typescript-frontend-dev` - Use for UI implementation with external models
- `frontend-architect` - Use for architecture planning with external models
- `senior-code-reviewer` - Use for code review (can delegate to external models)
- `test-architect` - Use for test planning/implementation

**Bun Backend Plugin:**
- `backend-developer` - Use for API implementation with external models
- `api-architect` - Use for API design with external models

**Code Analysis Plugin:**
- `codebase-detective` - Use for investigation tasks with external models

**No Plugin:**
- `general-purpose` - Default fallback for any task

### Step 5: Example Agent Selection

**Example 1: User says "use Grok to implement authentication"**
```
Task: Code implementation (authentication)
Plugin: Bun Backend (if backend) or Frontend (if UI)

Decision:
1. Check for backend-developer or typescript-frontend-dev agent
2. Found backend-developer? → Use it with Grok proxy
3. Not found? → Offer to create custom auth agent
4. User declines? → Use general-purpose with file-based pattern
```

**Example 2: User says "ask GPT-5 to review my API design"**
```
Task: Code review (API design)
Plugin: Bun Backend

Decision:
1. Check for api-architect or senior-code-reviewer agent
2. Found? → Use it with GPT-5 proxy
3. Not found? → Use general-purpose with review instructions
4. Never run directly in main context
```

**Example 3: User says "use Gemini to refactor this component"**
```
Task: Refactoring (component)
Plugin: Frontend

Decision:
1. No specialized refactoring agent exists
2. Offer to create component-refactoring agent
3. User declines? → Use typescript-frontend-dev with proxy
4. Still no agent? → Use general-purpose with file-based pattern
```

## Team Mode Integration

When used with the `/team` command for multi-model blind voting:

**External models are invoked via the `team` MCP tool:**
```
claudish team(mode="run", path=SESSION_DIR, models=["grok-code-fast-1", "gemini-3.1-pro-preview"],
  input=VOTE_PROMPT, timeout=180, claude_flags=claudeFlags)
```

The `team` tool runs all models in parallel internally and returns structured per-model results.
The agent role is communicated through the vote prompt content.

## Overview

**Claudish** is a CLI tool that allows running Claude Code with any OpenRouter model (Grok, GPT-5, MiniMax, Gemini, etc.) by proxying requests through a local Anthropic API-compatible server.

**Key Principle:** **ALWAYS** use Claudish through sub-agents with file-based instructions to avoid context window pollution.

## What is Claudish?

Claudish (Claude-ish) is a proxy tool that:
- ✅ Runs Claude Code with **any OpenRouter model** (not just Anthropic models)
- ✅ Supports **multiple backends** (OpenRouter, Gemini Direct, OpenAI Direct, Ollama, etc.)
- ✅ Uses local API-compatible proxy server
- ✅ Supports 100% of Claude Code features
- ✅ Provides cost tracking and model selection
- ✅ Enables multi-model workflows

**Use Cases:**
- Run tasks with different AI models (Grok for speed, GPT-5 for reasoning, Gemini for vision)
- Compare model performance on same task
- Reduce costs with cheaper models for simple tasks
- Access models with specialized capabilities

## Claudish Multi-Backend Routing

**CRITICAL:** Claudish supports MULTIPLE backends, not just OpenRouter. The model ID prefix determines which backend processes your request.

### Backend Routing Table

| Prefix | Backend | Required API Key | Example Model ID |
|--------|---------|------------------|------------------|
| (none) | OpenRouter | `OPENROUTER_API_KEY` | `anthropic/claude-3.5-sonnet` |
| `or/` | OpenRouter (explicit) | `OPENROUTER_API_KEY` | `google/gemini-3-pro-preview` |
| `g/` `gemini/` `google/` | Google Gemini Direct | `GEMINI_API_KEY` | `g/gemini-2.0-flash` |
| `oai/` `openai/` | OpenAI Direct | `OPENAI_API_KEY` | `oai/gpt-4o` |
| `ollama/` `ollama:` | Ollama (local) | None | `ollama/llama3.2` |
| `lmstudio/` | LM Studio (local) | None | `lmstudio/qwen2.5-coder` |
| `vllm/` | vLLM (local) | None | `vllm/mistral-7b` |
| `mlx/` | MLX (local) | None | `mlx/llama-3.2-3b` |
| `http://...` | Custom endpoint | None | `http://192.168.1.50:8000/model` |

### ⚠️ Prefix Collision Warning

**CRITICAL:** Some OpenRouter model IDs START with prefixes that claudish interprets as direct API routing!

| Model ID | Claudish Routes To | Problem | Fix |
|----------|-------------------|---------|-----|
| `google/gemini-3-pro-preview` | Google Gemini Direct | Needs `GEMINI_API_KEY`, different API | Use `google/gemini-3-pro-preview` |
| `gemini-3.1-pro-preview` | Google Gemini Direct | Needs `GEMINI_API_KEY`, different API | Use `gemini-3.1-pro-preview` |
| `gpt-5.3-codex` | OpenAI Direct | Needs `OPENAI_API_KEY`, different API | Use `gpt-5.3-codex` |
| `gpt-5.3` | OpenAI Direct | Needs `OPENAI_API_KEY`, different API | Use `gpt-5.3` |

### Safe Model IDs (No Collision)

These OpenRouter model IDs are SAFE to use without the `or/` prefix:

- `grok-code-fast-1` - No `x-ai/` prefix in claudish
- `anthropic/claude-3.5-sonnet` - No `anthropic/` prefix in claudish
- `deepseek/deepseek-chat` - No `deepseek/` prefix in claudish
- `minimax-m2.5` - No `minimax/` prefix in claudish
- `qwen/qwen3-coder:free` - No `qwen/` prefix in claudish
- `mistralai/devstral-2512:free` - No `mistralai/` prefix in claudish
- `moonshotai/kimi-k2-thinking` - No `moonshotai/` prefix in claudish

### When to Use `or/` Prefix

**ALWAYS use `or/` prefix when:**
1. The OpenRouter model ID starts with `google/`, `openai/`, `g/`, `oai/`
2. You want to GUARANTEE OpenRouter routing regardless of model ID
3. You're unsure if the model ID might collide

**Examples:**
```bash
# WRONG - Routes to Google Gemini Direct (needs GEMINI_API_KEY)
claudish --model google/gemini-3-pro-preview

# CORRECT - Routes to OpenRouter (needs OPENROUTER_API_KEY)
claudish --model google/gemini-3-pro-preview

# SAFE - No collision (x-ai/ is not a routing prefix)
claudish --model grok-code-fast-1
```

## Requirements

### System Requirements
- **OpenRouter API Key** - Required (set as `OPENROUTER_API_KEY` environment variable)
- **Claudish CLI** - Install with: `npm install -g claudish` or `bun install -g claudish`
- **Claude Code** - Must be installed

### Environment Variables

```bash
# OpenRouter (required for most models)
export OPENROUTER_API_KEY='sk-or-v1-...'

# Google Gemini Direct (optional - for g/gemini/google/ prefixed models)
export GEMINI_API_KEY='AIza...'

# OpenAI Direct (optional - for oai/openai/ prefixed models)
export OPENAI_API_KEY='sk-...'

# Note: Ollama, LM Studio, vLLM, MLX backends don't need API keys

# Optional (but recommended)
export ANTHROPIC_API_KEY='sk-ant-api03-placeholder'  # Prevents Claude Code dialog

# Optional - default model
export CLAUDISH_MODEL='grok-code-fast-1'  # or ANTHROPIC_MODEL
```

**Get OpenRouter API Key:**
1. Visit https://openrouter.ai/keys
2. Sign up (free tier available)
3. Create API key
4. Set as environment variable

## Quick Start Guide

### Step 1: Install Claudish

```bash
# With npm (works everywhere)
npm install -g claudish

# With Bun (faster)
bun install -g claudish

# Verify installation
claudish --version
```

### Step 2: Get Available Models

```bash
# Read the local model aliases file (synced from Firebase via /update-models)
cat shared/model-aliases.json

# Shows shortAliases (short names → full IDs), roles, teams, and knownModels sections
# Run /update-models to refresh from the queryPluginDefaults Firebase API

# Search available models (still works, fetches from OpenRouter API)
claudish --models gemini
claudish --models "grok code"

# Force update from OpenRouter API
claudish --models --force-update
```

### Step 3: Run Claudish

**Interactive Mode (default):**
```bash
# Shows model selector, persistent session
claudish
```

**Single-shot Mode:**
```bash
# One task and exit (requires --model)
claudish --model grok-code-fast-1 "implement user authentication"
```

**With stdin for large prompts:**
```bash
# Read prompt from stdin (useful for git diffs, code review)
git diff | claudish --stdin --model gpt-5.3-codex "Review these changes"
```

## Recommended Models

**Top Models for Development (verified from OpenRouter):**

1. **grok-code-fast-1** - xAI's Grok (fast coding, visible reasoning)
   - Category: coding
   - Context: 256K
   - Best for: Quick iterations, agentic coding

2. **gemini-3.1-pro-preview** - Google's Gemini (state-of-the-art reasoning)
   - Category: reasoning
   - Context: 1000K
   - Best for: Complex analysis, multi-step reasoning

3. **minimax-m2.5** - MiniMax M2 (high performance)
   - Category: coding
   - Context: 128K
   - Best for: General coding tasks

4. **gpt-5.3** - OpenAI's GPT-5 (advanced reasoning)
   - Category: reasoning
   - Context: 128K
   - Best for: Complex implementations, architecture decisions

5. **qwen/qwen3-vl-235b-a22b-instruct** - Alibaba's Qwen (vision-language)
   - Category: vision
   - Context: 32K
   - Best for: UI/visual tasks, design implementation

**Get Latest Models:**
```bash
# Read the authoritative model aliases file (primary source)
cat shared/model-aliases.json

# Search for specific models (fetches from OpenRouter API)
claudish --models grok
claudish --models "gemini flash"

# Force immediate update from OpenRouter
claudish --models --force-update
```

## Task Complexity: Direct vs File-Based

**Simple task (direct prompt):**
```bash
claudish --model grok-code-fast-1 "create button component"
```

**Complex task (file-based with --stdin):**
```bash
# Write instructions to file, pipe via --stdin
claudish --model grok-code-fast-1 --stdin < multi-phase-workflow.md
```

> **Note:** The `--agent` flag was removed in claudish v4.5.1. Agent specialization
> is now handled through the vote prompt content or Claude Code's own agent system.

## Best Practice: File-Based Sub-Agent Pattern

### ⚠️ CRITICAL: Don't Run Claudish Directly from Main Conversation

**Why:** Running Claudish directly in main conversation pollutes context window with:
- Entire conversation transcript
- All tool outputs
- Model reasoning (can be 10K+ tokens)

**Solution:** Use file-based sub-agent pattern

### File-Based Pattern (Recommended)

**Step 1: Create instruction file**
```markdown
# /tmp/claudish-task-{timestamp}.md

## Task
Implement user authentication with JWT tokens

## Requirements
- Use bcrypt for password hashing
- Generate JWT with 24h expiration
- Add middleware for protected routes

## Deliverables
Write implementation to: /tmp/claudish-result-{timestamp}.md

## Output Format
```markdown
## Implementation

[code here]

## Files Created/Modified
- path/to/file1.ts
- path/to/file2.ts

## Tests
[test code if applicable]

## Notes
[any important notes]
```
```

**Step 2: Run Claudish with file instruction**
```bash
# Read instruction from file, write result to file
claudish --model grok-code-fast-1 --stdin < /tmp/claudish-task-{timestamp}.md > /tmp/claudish-result-{timestamp}.md
```

**Step 3: Read result file and provide summary**
```typescript
// In your agent/command:
const result = await Read({ file_path: "/tmp/claudish-result-{timestamp}.md" });

// Parse result
const filesModified = extractFilesModified(result);
const summary = extractSummary(result);

// Provide short feedback to main agent
return `✅ Task completed. Modified ${filesModified.length} files. ${summary}`;
```

### Complete Example: Using Claudish in Sub-Agent

```typescript
/**
 * Example: Run code review with Grok via Claudish sub-agent
 */
async function runCodeReviewWithGrok(files: string[]) {
  const timestamp = Date.now();
  const instructionFile = `/tmp/claudish-review-instruction-${timestamp}.md`;
  const resultFile = `/tmp/claudish-review-result-${timestamp}.md`;

  // Step 1: Create instruction file
  const instruction = `# Code Review Task

## Files to Review
${files.map(f => `- ${f}`).join('\n')}

## Review Criteria
- Code quality and maintainability
- Potential bugs or issues
- Performance considerations
- Security vulnerabilities

## Output Format
Write your review to: ${resultFile}

Use this format:
\`\`\`markdown
## Summary
[Brief overview]

## Issues Found
### Critical
- [issue 1]

### Medium
- [issue 2]

### Low
- [issue 3]

## Recommendations
- [recommendation 1]

## Files Reviewed
- [file 1]: [status]
\`\`\`
`;

  await Write({ file_path: instructionFile, content: instruction });

  // Step 2: Run Claudish with stdin
  await Bash(`claudish --model grok-code-fast-1 --stdin < ${instructionFile}`);

  // Step 3: Read result
  const result = await Read({ file_path: resultFile });

  // Step 4: Parse and return summary
  const summary = extractSummary(result);
  const issueCount = extractIssueCount(result);

  // Step 5: Clean up temp files
  await Bash(`rm ${instructionFile} ${resultFile}`);

  // Step 6: Return concise feedback
  return {
    success: true,
    summary,
    issueCount,
    fullReview: result  // Available if needed, but not in main context
  };
}

function extractSummary(review: string): string {
  const match = review.match(/## Summary\s*\n(.*?)(?=\n##|$)/s);
  return match ? match[1].trim() : "Review completed";
}

function extractIssueCount(review: string): { critical: number; medium: number; low: number } {
  const critical = (review.match(/### Critical\s*\n(.*?)(?=\n###|$)/s)?.[1].match(/^-/gm) || []).length;
  const medium = (review.match(/### Medium\s*\n(.*?)(?=\n###|$)/s)?.[1].match(/^-/gm) || []).length;
  const low = (review.match(/### Low\s*\n(.*?)(?=\n###|$)/s)?.[1].match(/^-/gm) || []).length;

  return { critical, medium, low };
}
```

## Sub-Agent Delegation Pattern

When running Claudish from an agent, use the Task tool to create a sub-agent:

### Pattern 1: Simple Task Delegation

```typescript
/**
 * Example: Delegate implementation to Grok via Claudish
 */
async function implementFeatureWithGrok(featureDescription: string) {
  // Use Task tool to create sub-agent
  const result = await Task({
    subagent_type: "general-purpose",
    description: "Implement feature with Grok",
    prompt: `
Use Claudish CLI to implement this feature with Grok model:

${featureDescription}

INSTRUCTIONS:
1. Search for available models:
   claudish --models grok

2. Run implementation with Grok:
   claudish --model grok-code-fast-1 "${featureDescription}"

3. Return ONLY:
   - List of files created/modified
   - Brief summary (2-3 sentences)
   - Any errors encountered

DO NOT return the full conversation transcript or implementation details.
Keep your response under 500 tokens.
    `
  });

  return result;
}
```

### Pattern 2: File-Based Task Delegation

```typescript
/**
 * Example: Use file-based instruction pattern in sub-agent
 */
async function analyzeCodeWithGemini(codebasePath: string) {
  const timestamp = Date.now();
  const instructionFile = `/tmp/claudish-analyze-${timestamp}.md`;
  const resultFile = `/tmp/claudish-analyze-result-${timestamp}.md`;

  // Create instruction file
  const instruction = `# Codebase Analysis Task

## Codebase Path
${codebasePath}

## Analysis Required
- Architecture overview
- Key patterns used
- Potential improvements
- Security considerations

## Output
Write analysis to: ${resultFile}

Keep analysis concise (under 1000 words).
`;

  await Write({ file_path: instructionFile, content: instruction });

  // Delegate to sub-agent
  const result = await Task({
    subagent_type: "general-purpose",
    description: "Analyze codebase with Gemini",
    prompt: `
Use Claudish to analyze codebase with Gemini model.

Instruction file: ${instructionFile}
Result file: ${resultFile}

STEPS:
1. Read instruction file: ${instructionFile}
2. Run: claudish --model gemini-3.1-pro-preview --stdin < ${instructionFile}
3. Wait for completion
4. Read result file: ${resultFile}
5. Return ONLY a 2-3 sentence summary

DO NOT include the full analysis in your response.
The full analysis is in ${resultFile} if needed.
    `
  });

  // Read full result if needed
  const fullAnalysis = await Read({ file_path: resultFile });

  // Clean up
  await Bash(`rm ${instructionFile} ${resultFile}`);

  return {
    summary: result,
    fullAnalysis
  };
}
```

### Pattern 3: Multi-Model Comparison

```typescript
/**
 * Example: Run same task with multiple models and compare
 */
async function compareModels(task: string, models: string[]) {
  const results = [];

  for (const model of models) {
    const timestamp = Date.now();
    const resultFile = `/tmp/claudish-${model.replace('/', '-')}-${timestamp}.md`;

    // Run task with each model
    await Task({
      subagent_type: "general-purpose",
      description: `Run task with ${model}`,
      prompt: `
Use Claudish to run this task with ${model}:

${task}

STEPS:
1. Run: claudish --model ${model} --json "${task}"
2. Parse JSON output
3. Return ONLY:
   - Cost (from total_cost_usd)
   - Duration (from duration_ms)
   - Token usage (from usage.input_tokens and usage.output_tokens)
   - Brief quality assessment (1-2 sentences)

DO NOT return full output.
      `
    });

    results.push({
      model,
      resultFile
    });
  }

  return results;
}
```

## Common Workflows

### Workflow 1: Quick Code Generation with Grok

```bash
# Fast, agentic coding with visible reasoning
claudish --model grok-code-fast-1 "add error handling to api routes"
```

### Workflow 2: Complex Refactoring with GPT-5

```bash
# Advanced reasoning for complex tasks
claudish --model gpt-5.3 "refactor authentication system to use OAuth2"
```

### Workflow 3: UI Implementation with Qwen (Vision)

```bash
# Vision-language model for UI tasks
claudish --model qwen/qwen3-vl-235b-a22b-instruct "implement dashboard from figma design"
```

### Workflow 4: Code Review with Gemini

```bash
# State-of-the-art reasoning for thorough review
git diff | claudish --stdin --model gemini-3.1-pro-preview "Review these changes for bugs and improvements"
```

### Workflow 5: Multi-Model Consensus

```bash
# Run same task with multiple models
for model in "grok-code-fast-1" "gemini-3.1-pro-preview" "gpt-5.3"; do
  echo "=== Testing with $model ==="
  claudish --model "$model" "find security vulnerabilities in auth.ts"
done
```

## Claudish CLI Flags Reference

### Essential Flags

| Flag | Description | Example |
|------|-------------|---------|
| `--model <model>` | OpenRouter model to use | `--model grok-code-fast-1` |
| `--stdin` | Read prompt from stdin | `git diff \| claudish --stdin --model grok` |
| `--models` | List all models or search | `claudish --models` or `claudish --models gemini` |
| `--top-models` | ~~Show top recommended models~~ (deprecated — use `shared/model-aliases.json`) | `cat shared/model-aliases.json` |
| `--json` | JSON output (implies --quiet) | `claudish --json "task"` |
| `--help-ai` | Print AI agent usage guide | `claudish --help-ai` |

### Advanced Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--interactive` / `-i` | Interactive mode | Auto (no prompt = interactive) |
| `--quiet` / `-q` | Suppress log messages | Quiet in single-shot |
| `--verbose` / `-v` | Show log messages | Verbose in interactive |
| `--debug` / `-d` | Enable debug logging to file | Disabled |
| `--port <port>` | Proxy server port | Random (3000-9000) |
| `--no-auto-approve` | Require permission prompts | Auto-approve enabled |
| `--dangerous` | Disable sandbox | Disabled |
| `--monitor` | Proxy to real Anthropic API (debug) | Disabled |
| `--force-update` | Force refresh model cache | Auto (>2 days) |

### Output Modes

1. **Quiet Mode (default in single-shot)**
   ```bash
   claudish --model grok "task"
   # Clean output, no [claudish] logs
   ```

2. **Verbose Mode**
   ```bash
   claudish --verbose "task"
   # Shows all [claudish] logs for debugging
   ```

3. **JSON Mode**
   ```bash
   claudish --json "task"
   # Structured output: {result, cost, usage, duration}
   ```

## Cost Tracking

Claudish automatically tracks costs in the status line:

```
directory • model-id • $cost • ctx%
```

**Example:**
```
my-project • grok-code-fast-1 • $0.12 • 67%
```

Shows:
- 💰 **Cost**: $0.12 USD spent in current session
- 📊 **Context**: 67% of context window remaining

**JSON Output Cost:**
```bash
claudish --json "task" | jq '.total_cost_usd'
# Output: 0.068
```

## Error Handling

### Error 1: OPENROUTER_API_KEY Not Set

**Error:**
```
Error: OPENROUTER_API_KEY environment variable is required
```

**Fix:**
```bash
export OPENROUTER_API_KEY='sk-or-v1-...'
# Or add to ~/.zshrc or ~/.bashrc
```

### Error 2: Claudish Not Installed

**Error:**
```
command not found: claudish
```

**Fix:**
```bash
npm install -g claudish
# Or: bun install -g claudish
```

### Error 3: Model Not Found

**Error:**
```
Model 'invalid/model' not found
```

**Fix:**
```bash
# Check available models in the aliases file
cat shared/model-aliases.json

# Or search via OpenRouter API
claudish --models

# Use valid model ID
claudish --model grok-code-fast-1 "task"
```

### Error 4: OpenRouter API Error

**Error:**
```
OpenRouter API error: 401 Unauthorized
```

**Fix:**
1. Check API key is correct
2. Verify API key at https://openrouter.ai/keys
3. Check API key has credits (free tier or paid)

### Error 5: Port Already in Use

**Error:**
```
Error: Port 3000 already in use
```

**Fix:**
```bash
# Let Claudish pick random port (default)
claudish --model grok "task"

# Or specify different port
claudish --port 8080 --model grok "task"
```

## Best Practices

### 1. ✅ Use File-Based Instructions

**Why:** Avoids context window pollution

**How:**
```bash
# Write instruction to file
echo "Implement feature X" > /tmp/task.md

# Run with stdin
claudish --stdin --model grok < /tmp/task.md > /tmp/result.md

# Read result
cat /tmp/result.md
```

### 2. ✅ Choose Right Model for Task

**Fast Coding:** `grok-code-fast-1`
**Complex Reasoning:** `gemini-3.1-pro-preview` or `gpt-5.3`
**Vision/UI:** `qwen/qwen3-vl-235b-a22b-instruct`

### 3. ✅ Use --json for Automation

**Why:** Structured output, easier parsing

**How:**
```bash
RESULT=$(claudish --json "task" | jq -r '.result')
COST=$(claudish --json "task" | jq -r '.total_cost_usd')
```

### 4. ✅ Delegate to Sub-Agents

**Why:** Keeps main conversation context clean

**How:**
```typescript
await Task({
  subagent_type: "general-purpose",
  description: "Task with Claudish",
  prompt: "Use claudish --model grok '...' and return summary only"
});
```

### 5. ✅ Update Models Regularly

**Why:** Get latest model recommendations

**How:**
```bash
# Run /update-models command to sync from Firebase queryPluginDefaults API
# This writes to shared/model-aliases.json

# Then read the authoritative list:
cat shared/model-aliases.json

# Search for specific models via OpenRouter (supplemental)
claudish --models deepseek

# Force update from OpenRouter now
claudish --models --force-update
```

### 6. ✅ Use --stdin for Large Prompts

**Why:** Avoid command line length limits

**How:**
```bash
git diff | claudish --stdin --model grok "Review changes"
```

## Anti-Patterns (Avoid These)

### ❌❌❌ NEVER Run Claudish Directly in Main Conversation (CRITICAL)

**This is the #1 mistake. Never do this unless user explicitly requests it.**

**WRONG - Destroys context window:**
```typescript
// ❌ NEVER DO THIS - Pollutes main context with 10K+ tokens
await Bash("claudish --model grok 'implement feature'");

// ❌ NEVER DO THIS - Full conversation in main context
await Bash("claudish --model gemini 'review code'");

// ❌ NEVER DO THIS - Even with --json, output is huge
const result = await Bash("claudish --json --model gpt-5 'refactor'");
```

**RIGHT - Always use sub-agents:**
```typescript
// ✅ ALWAYS DO THIS - Delegate to sub-agent
const result = await Task({
  subagent_type: "general-purpose", // or specific agent
  description: "Implement feature with Grok",
  prompt: `
Use Claudish to implement the feature with Grok model.

CRITICAL INSTRUCTIONS:
1. Create instruction file: /tmp/claudish-task-${Date.now()}.md
2. Write detailed task requirements to file
3. Run: claudish --model grok-code-fast-1 --stdin < /tmp/claudish-task-*.md
4. Read result file and return ONLY a 2-3 sentence summary

DO NOT return full implementation or conversation.
Keep response under 300 tokens.
  `
});

// ✅ Even better - Use specialized agent if available
const result = await Task({
  subagent_type: "backend-developer", // or frontend-dev, etc.
  description: "Implement with external model",
  prompt: `
Use Claudish with grok-code-fast-1 model to implement authentication.
Follow file-based instruction pattern.
Return summary only.
  `
});
```

**When you CAN run directly (rare exceptions):**
```typescript
// ✅ Only when user explicitly requests
// User: "Run claudish directly in main context for debugging"
if (userExplicitlyRequestedDirect) {
  await Bash("claudish --model grok 'task'");
}
```

### ❌ Don't Ignore Model Selection

**Wrong:**
```bash
# Always using default model
claudish "any task"
```

**Right:**
```bash
# Choose appropriate model
claudish --model grok-code-fast-1 "quick fix"
claudish --model gemini-3.1-pro-preview "complex analysis"
```

### ❌ Don't Parse Text Output

**Wrong:**
```bash
OUTPUT=$(claudish --model grok "task")
COST=$(echo "$OUTPUT" | grep cost | awk '{print $2}')
```

**Right:**
```bash
# Use JSON output
COST=$(claudish --json --model grok "task" | jq -r '.total_cost_usd')
```

### ❌ Don't Hardcode Model Lists

**Wrong:**
```typescript
const MODELS = ["grok-code-fast-1", "gpt-5.3"];
```

**Right:**
```typescript
// Read from the authoritative model aliases file
const aliases = JSON.parse(await Bun.file("shared/model-aliases.json").text());
const models = Object.keys(aliases.knownModels);
```

### ✅ Do Accept Custom Models From Users

**Problem:** User provides a custom model ID that's not in `shared/model-aliases.json`

**Wrong (rejecting custom models):**
```typescript
const availableModels = ["grok-code-fast-1", "gpt-5.3"];
const userModel = "custom/provider/model-123";

if (!availableModels.includes(userModel)) {
  throw new Error("Model not in my shortlist"); // ❌ DON'T DO THIS
}
```

**Right (accept any valid model ID):**
```typescript
// Claudish accepts ANY valid OpenRouter model ID, even if not in shared/model-aliases.json
const userModel = "custom/provider/model-123";

// Validate it's a non-empty string with provider format
if (!userModel.includes("/")) {
  console.warn("Model should be in format: provider/model-name");
}

// Use it directly - Claudish will validate with OpenRouter
await Bash(`claudish --model ${userModel} "task"`);
```

**Why:** Users may have access to:
- Beta/experimental models
- Private/custom fine-tuned models
- Newly released models not yet in rankings
- Regional/enterprise models
- Cost-saving alternatives

**Always accept user-provided model IDs** unless they're clearly invalid (empty, wrong format).

### ✅ Do Handle User-Preferred Models

**Scenario:** User says "use my custom model X" and expects it to be remembered

**Solution 1: Environment Variable (Recommended)**
```typescript
// Set for the session
process.env.CLAUDISH_MODEL = userPreferredModel;

// Or set permanently in user's shell profile
await Bash(`echo 'export CLAUDISH_MODEL="${userPreferredModel}"' >> ~/.zshrc`);
```

**Solution 2: Session Cache**
```typescript
// Store in a temporary session file
const sessionFile = "/tmp/claudish-user-preferences.json";
const prefs = {
  preferredModel: userPreferredModel,
  lastUsed: new Date().toISOString()
};
await Write({ file_path: sessionFile, content: JSON.stringify(prefs, null, 2) });

// Load in subsequent commands
const { stdout } = await Read({ file_path: sessionFile });
const prefs = JSON.parse(stdout);
const model = prefs.preferredModel || defaultModel;
```

**Solution 3: Prompt Once, Remember for Session**
```typescript
// In a multi-step workflow, ask once
if (!process.env.CLAUDISH_MODEL) {
  const aliases = JSON.parse(await Bun.file("shared/model-aliases.json").text());
  const models = Object.entries(aliases.knownModels).map(([id, info]) => ({ id, ...(info as object) }));

  const response = await AskUserQuestion({
    question: "Select model (or enter custom model ID):",
    options: models.map((m) => ({ label: m.id, value: m.id })).concat([
      { label: "Enter custom model...", value: "custom" }
    ])
  });

  if (response === "custom") {
    const customModel = await AskUserQuestion({
      question: "Enter OpenRouter model ID (format: provider/model):"
    });
    process.env.CLAUDISH_MODEL = customModel;
  } else {
    process.env.CLAUDISH_MODEL = response;
  }
}

// Use the selected model for all subsequent calls
const model = process.env.CLAUDISH_MODEL;
await Bash(`claudish --model ${model} "task 1"`);
await Bash(`claudish --model ${model} "task 2"`);
```

**Guidance for Agents:**
1. ✅ **Accept any model ID** user provides (unless obviously malformed)
2. ✅ **Don't filter** based on your "shortlist" - let Claudish handle validation
3. ✅ **Offer to set CLAUDISH_MODEL** environment variable for session persistence
4. ✅ **Explain** that `shared/model-aliases.json` contains curated model recommendations (run `/update-models` to refresh)
5. ✅ **Validate format** (should contain "/") but not restrict to known models
6. ❌ **Never reject** a user's custom model with "not in my shortlist"

### ❌ Don't Skip Error Handling

**In orchestration workflows, use MCP tools with proper error handling:**

```
// Use create_session and react to channel events
create_session(model="grok-code-fast-1", prompt=TASK, timeout_seconds=300)

// On "failed" channel event → STOP and REPORT
// "Grok failed: {error content}. Options: (1) Retry, (2) Different model, (3) Skip, (4) Cancel"

// On "completed" → get_output(session_id)
```

**❌ NEVER do silent fallback:**
```
// ❌ WRONG — silently substitutes a different model on failure
// If create_session fails for Gemini, don't silently run with embedded Claude instead
// ALWAYS report the failure and let the user decide
```

## Agent Integration Examples

### Example 1: Code Review Agent

```typescript
/**
 * Agent: code-reviewer (using Claudish with multiple models)
 */
async function reviewCodeWithMultipleModels(files: string[]) {
  const models = [
    "grok-code-fast-1",      // Fast initial scan
    "gemini-3.1-pro-preview",    // Deep analysis
    "gpt-5.3"                // Final validation
  ];

  const reviews = [];

  for (const model of models) {
    const timestamp = Date.now();
    const instructionFile = `/tmp/review-${model.replace('/', '-')}-${timestamp}.md`;
    const resultFile = `/tmp/review-result-${model.replace('/', '-')}-${timestamp}.md`;

    // Create instruction
    const instruction = createReviewInstruction(files, resultFile);
    await Write({ file_path: instructionFile, content: instruction });

    // Run review with model
    await Bash(`claudish --model ${model} --stdin < ${instructionFile}`);

    // Read result
    const result = await Read({ file_path: resultFile });

    // Extract summary
    reviews.push({
      model,
      summary: extractSummary(result),
      issueCount: extractIssueCount(result)
    });

    // Clean up
    await Bash(`rm ${instructionFile} ${resultFile}`);
  }

  return reviews;
}
```

### Example 2: Feature Implementation Command

```typescript
/**
 * Command: /implement-with-model
 * Usage: /implement-with-model "feature description"
 */
async function implementWithModel(featureDescription: string) {
  // Step 1: Get available models from the authoritative aliases file
  const aliases = JSON.parse(await Bun.file("shared/model-aliases.json").text());
  const models = Object.entries(aliases.knownModels).map(([id, info]) => ({ id, ...(info as object) }));

  // Step 2: Let user select model
  const selectedModel = await promptUserForModel(models);

  // Step 3: Create instruction file
  const timestamp = Date.now();
  const instructionFile = `/tmp/implement-${timestamp}.md`;
  const resultFile = `/tmp/implement-result-${timestamp}.md`;

  const instruction = `# Feature Implementation

## Description
${featureDescription}

## Requirements
- Write clean, maintainable code
- Add comprehensive tests
- Include error handling
- Follow project conventions

## Output
Write implementation details to: ${resultFile}

Include:
- Files created/modified
- Code snippets
- Test coverage
- Documentation updates
`;

  await Write({ file_path: instructionFile, content: instruction });

  // Step 4: Run implementation
  await Bash(`claudish --model ${selectedModel} --stdin < ${instructionFile}`);

  // Step 5: Read and present results
  const result = await Read({ file_path: resultFile });

  // Step 6: Clean up
  await Bash(`rm ${instructionFile} ${resultFile}`);

  return result;
}
```

## Troubleshooting

### Issue: Slow Performance

**Symptoms:** Claudish takes long time to respond

**Solutions:**
1. Use faster model: `grok-code-fast-1` or `minimax-m2.5`
2. Reduce prompt size (use --stdin with concise instructions)
3. Check internet connection to OpenRouter

### Issue: High Costs

**Symptoms:** Unexpected API costs

**Solutions:**
1. Use budget-friendly models (check pricing in `shared/model-aliases.json` or with `claudish --models`)
2. Enable cost tracking: `--cost-tracker`
3. Use --json to monitor costs: `claudish --json "task" | jq '.total_cost_usd'`

### Issue: Context Window Exceeded

**Symptoms:** Error about token limits

**Solutions:**
1. Use model with larger context (Gemini: 1000K, Grok: 256K)
2. Break task into smaller subtasks
3. Use file-based pattern to avoid conversation history

### Issue: Model Not Available

**Symptoms:** "Model not found" error

**Solutions:**
1. Update model cache: `claudish --models --force-update`
2. Check OpenRouter website for model availability
3. Use alternative model from same category

## Additional Resources

**Documentation:**
- AI Agent Guide: Print with `claudish --help-ai`
- Full documentation at GitHub repository

**External Links:**
- Claudish GitHub: https://github.com/MadAppGang/claudish
- Install: `npm install -g claudish`
- OpenRouter: https://openrouter.ai
- OpenRouter Models: https://openrouter.ai/models
- OpenRouter API Docs: https://openrouter.ai/docs

**Version Information:**
```bash
claudish --version
```

**Get Help:**
```bash
claudish --help        # CLI usage
claudish --help-ai     # AI agent usage guide
```

---

**Maintained by:** MadAppGang
**Last Updated:** November 25, 2025
**Skill Version:** 1.1.0
