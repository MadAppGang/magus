---
name: claudish-usage
description: Routes Claudish between MCP tools (team, create_session for /team and /delegate) and the CLI for direct usage. Use when the user mentions claudish, OpenRouter, or external AI models.
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

## Model Alias Resolution

All commands that use external models (/team, /delegate, /dev:fix, etc.) MUST resolve model names through this three-step chain before calling claudish.

**The catalog is live, never committed.** Model IDs come from the `list_models` /
`search_models` MCP tools, which claudish serves from its own Firebase-backed
catalog with a 24-hour cache. There is no model-aliases file in this repo, and
you must not resolve model IDs from memory — training data carries dead IDs.

### Three-Step Resolution Chain

```
Step 1: INTERPRET (Claude Code LLM)
  User says anything → Claude infers what family/capability they mean
  "use Elon's model"     → xAI family
  "the Google one"       → Google family
  "kimi3"                → Moonshot family, major version 3
  "latest gpt"           → OpenAI family, newest version

Step 2: RESOLVE (live catalog lookup — list_models / search_models)
  Family/intent → an ID that EXISTS in the live catalog right now
  xAI family             → whatever grok-* the catalog currently lists
  "kimi3"                → kimi-k3   (matched in the catalog, not guessed)
  "latest gpt"           → highest gpt-* version the catalog lists

Step 3: ROUTE (Claudish)
  Live model ID → correct provider API endpoint
```

### Resolving a model name

1. Call `list_models` first — it is cheap, cached, and returns the current
   recommended set with pricing, capabilities and access prefixes.
2. If the user's request isn't covered there, call `search_models` with the
   family name (e.g. `search_models("kimi")`) to see every live variant.
3. Check `.claude/multimodel-team.json` → `customAliases` for a user-defined
   shorthand. A custom alias always wins on key conflict — but if it maps to an
   ID the catalog no longer lists, say so instead of using it silently.
4. `"internal"` is never sent to claudish — it means the host Claude model.

### Use the resolver — do not do this by hand

`scripts/resolve-models.ts` performs the whole check and prints the disclosure.
Call `list_models` first, then hand it the IDs:

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-models.ts" \
  --catalog "<comma-separated ids from list_models>" [--context review] [--json]
```

It verifies every model-bearing field, drops dead IDs individually, computes
provenance, and emits a receipt — **print that receipt verbatim.** Exit `3` means
nothing survived; `0` means proceed with what it selected.

Doing this in your head is what the rest of this section explains, and it is the
fallback for paths the resolver does not cover. Measured over 30 benchmark runs,
prose alone produced the disclosure at best 14/15 times; the resolver produces it
every time, because it is code.

### Verify every field of the preferences file

`customAliases` is not the only place a dead ID hides, and in practice it is the
least likely — a file found in the wild had `customAliases: {}` and six
decommissioned IDs sitting in `defaultModels`. **Verify every ID you take from
this file against the live catalog, whichever field it came from:**

| Field | Verify? |
|---|---|
| `defaultModels` | yes |
| `contextPreferences[*]` | yes |
| `customAliases` values | yes |

No field is exempt. Drop each ID the catalog does not list, name the dropped IDs
in your reply, and **carry on with the survivors.**

**A dead entry invalidates that entry, never the request.** Resolving is the next
step, not a fallback:

- A stale `customAliases` mapping means *the alias* is wrong. If the user named a
  version, resolve that intent against the catalog and use what you find —
  `kimi3` with a dead `kimi3 → kimi-k2.5` alias still resolves to `kimi-k3` when
  the catalog lists it.
- Dead entries in `defaultModels` or `contextPreferences[*]` mean *those entries*
  are wrong. Run with whatever survives.

Returning "no models" is correct only when the catalog genuinely offers nothing
that satisfies the request. Refusing a run while a live model sits in the catalog
is the same failure as using a dead one — it just fails in the other direction.

### Report what the check found, not what the file claims

When you report your model choice, **state the result of the catalog check**:

> `3 of 7 saved model IDs are no longer in the catalog: grok-4.20-beta, gpt-5.4, kimi-k2.5`

Report it every run, including when nothing was dropped — `all 5 saved IDs are
still live` is the same disclosure with a different value.

That count is derived from the comparison you just performed, so it **cannot be
silently wrong**. It is the disclosure that matters: the user's question is "are
my models alive and what did you actually use", not "what date is in my file".

### File age is secondary, and `lastUpdated` cannot carry it

If you state an age, take it from the **file's modification time** and say so:
`preferences file modified 12 days ago (filesystem mtime)`.

- **Never present `lastUpdated` as the file's age.** It is declared metadata and
  is not maintained by every write path — a file has been seen reporting March
  while its own `history[0].date` said July. Quoting it as an age is false
  precision.
- If `lastUpdated` and the newest `history[].date` disagree, report
  `freshness metadata inconsistent` and name both. Do not pick the newer one.
- If no trustworthy source exists, `freshness unknown` is a complete answer.
- `mtime` has its own limits — a checkout or copy resets it — which is exactly
  why the source is always labelled.

**Age never gates.** It never rejects a model (a 157-day-old file whose IDs are
all live is fine — use it) and never approves one (a file written today can be
entirely dead). Catalog membership is what decides; age is context for the human.

### Version intent is a hard constraint, not a hint

When the user names a version — `kimi3`, `gpt-5.6`, `sonnet 5` — that version is
a **requirement**. Resolve it against the catalog and use what you find.

- If the exact version exists → use it.
- If it does not exist → **say so and show the live alternatives.** Ask which
  one they want.
- **NEVER** fall back to a lower version because its name is closer as a string.
  `kimi3` resolving to `kimi-k3` is a bug, not a near-miss: string distance
  cannot tell a version bump from a typo, and silently downgrading a model is
  worse than erroring.

### Interpreting User Intent (Step 1)

| User says | Resolve by | Notes |
|---|---|---|
| "grok" | `search_models("grok")` | Take the current flagship, not a remembered ID |
| "Elon's AI" / "xAI model" | `search_models("grok")` | Company association |
| "Google's model" | `search_models("gemini")` | Company association |
| "the cheap one" | `list_models` → Quick picks → Budget | Cost intent |
| "something fast for coding" | `list_models` → Fast variants | Capability intent |
| "biggest context" | `list_models` → Quick picks → Large context | Capability intent |
| "kimi3" | `search_models("kimi")`, require major v3 | Version is a constraint |
| "LATEST_MINIMAX_MODEL" | Verify it's in the catalog, then pass through | Already a full ID |

When uncertain, show the live candidates and ask the user to pick. Listing real
options is always better than guessing one.

### Identity vs routing address

Every catalog record carries the model's **identity** and several **addresses** for
reaching it. Only the identity is the model. Addresses live in sibling fields, so it is
easy to copy the wrong one out of the same record:

| In the record | Example | What it is |
|---|---|---|
| `id` | `kimi-k3` | **the identity — this is the model** |
| `openrouterId` | `moonshotai/kimi-k3` | an address: route via OpenRouter |
| Access line | `kimi@kimi-k3` · `kc@kimi-k3` | addresses: same model, different accounts |

**Bare means no `@` AND no `/`.** `moonshotai/kimi-k3` is not a bare ID — the vendor
slug is a route, not part of the name. Both prefix forms pin the request to one
provider and bypass the subscription-aware backend selection and fallback that passing
`id` gives you. `z-ai/glm-5.2` is as wrong as `gc@glm-5.2`, for the same reason.

- If the user names an address (`cx@LATEST_GPT_MODEL`), pass it through **verbatim**.
- Otherwise pass `id`, and let claudish pick the backend.
- Never assemble an address yourself, and never substitute one field for another —
  "the catalog reports it" is not a licence to send it, because the catalog reports
  every address too.

### Responsibility Boundaries

| Responsibility | Owner |
|---|---|
| Understanding user intent → family/capability | **Claude Code** (LLM heuristic) |
| Which model IDs exist right now | **Claudish** (live catalog, 24h cache) |
| User custom aliases | **Magus** (`.claude/multimodel-team.json` `customAliases`) |
| Model ID → API endpoint | **Claudish** (provider routing) |
| API keys, backend fallbacks | **Claudish** |

### Rules

- ALWAYS resolve against the live catalog; NEVER from memory or a committed file
- NEVER invent a model ID — if nothing matches, show live options and ask
- NEVER silently downgrade to an older version than the user asked for
- ALWAYS send the catalog's `id`. NEVER send an address (`vendor/model`,
  `provider@model`) where a model belongs — not even one the catalog reports, since it
  reports `openrouterId` and every Access route alongside `id`. An address goes through
  only when the user named it themselves
- User `customAliases` override, but flag any that the catalog no longer lists

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
| **Code review** | `dev:reviewer` | `code-analysis:detective` | Security, correctness, maintainability passes |
| **Architecture** | `dev:architect` | — | Design and planning tasks |
| **Implementation** | `dev:developer` | — | Building features |
| **Testing** | `dev:test-architect` | — | Test strategy and coverage |
| **Debugging** | `dev:debugger` | — | Error analysis and tracing |
| **Documentation** | `dev:docs` | `dev:researcher` | Writing or auditing documentation |
| **UI/Design** | `dev:frontend` | `designer` plugin | Visual and UX tasks |

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
claudish team(mode="run", path=SESSION_DIR, models=["grok", "gemini"],
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
| (none) | OpenRouter | `OPENROUTER_API_KEY` | `anthropic/LATEST_SONNET_MODEL` |
| `or/` | OpenRouter (explicit) | `OPENROUTER_API_KEY` | `google/LATEST_GEMINI_MODEL` |
| `g/` `gemini/` `google/` | Google Gemini Direct | `GEMINI_API_KEY` | `g/LATEST_GEMINI_MODEL` |
| `oai/` `openai/` | OpenAI Direct | `OPENAI_API_KEY` | `oai/LATEST_GPT_MODEL` |
| `ollama/` `ollama:` | Ollama (local) | None | `ollama/LOCAL_MODEL` |
| `lmstudio/` | LM Studio (local) | None | `lmstudio/LOCAL_MODEL` |
| `vllm/` | vLLM (local) | None | `vllm/LOCAL_MODEL` |
| `mlx/` | MLX (local) | None | `mlx/LOCAL_MODEL` |
| `http://...` | Custom endpoint | None | `http://192.168.1.50:8000/model` |

### ⚠️ Prefix Collision Warning

**CRITICAL:** Some OpenRouter model IDs START with prefixes that claudish interprets as direct API routing!

| Model ID | Claudish Routes To | Problem | Fix |
|----------|-------------------|---------|-----|
| `google/LATEST_GEMINI_MODEL` | Google Gemini Direct | Needs `GEMINI_API_KEY`, different API | Use `gemini` |
| `gemini` | Google Gemini Direct | Needs `GEMINI_API_KEY`, different API | Use `gemini` |
| `gpt` | OpenAI Direct | Needs `OPENAI_API_KEY`, different API | Use `gpt` |
| `gpt` | OpenAI Direct | Needs `OPENAI_API_KEY`, different API | Use `gpt` |

### Safe Model IDs (No Collision)

These OpenRouter model IDs are SAFE to use without the `or/` prefix:

- `grok` - No `x-ai/` prefix in claudish
- `anthropic/LATEST_SONNET_MODEL` - No `anthropic/` prefix in claudish
- `deepseek/deepseek-chat` - No `deepseek/` prefix in claudish
- `minimax` - No `minimax/` prefix in claudish
- `qwen/LATEST_FREE_CODING_MODEL` - No `qwen/` prefix in claudish
- `mistralai/LATEST_FREE_CODING_MODEL` - No `mistralai/` prefix in claudish
- `moonshotai/LATEST_KIMI_MODEL` - No `moonshotai/` prefix in claudish

### When to Use `or/` Prefix

**ALWAYS use `or/` prefix when:**
1. The OpenRouter model ID starts with `google/`, `openai/`, `g/`, `oai/`
2. You want to GUARANTEE OpenRouter routing regardless of model ID
3. You're unsure if the model ID might collide

**Examples:**
```bash
# WRONG - Routes to Google Gemini Direct (needs GEMINI_API_KEY)
claudish --model google/LATEST_GEMINI_MODEL

# CORRECT - Use alias instead
claudish --model gemini

# SAFE - No collision (x-ai/ is not a routing prefix)
claudish --model grok
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
export CLAUDISH_MODEL='grok'  # or ANTHROPIC_MODEL
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

In orchestration, use the MCP tools — `list_models` for the current recommended
set (with pricing, capabilities and access prefixes) and `search_models` for
every live variant in a family. Both are served from claudish's catalog with a
24-hour cache, so they are always current without a manual sync step.

For direct CLI use:

```bash
# Search available models
claudish --models gemini
claudish --models "grok code"

# Force a catalog refresh (otherwise the 24h cache applies)
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
claudish --model grok "implement user authentication"
```

**With stdin for large prompts:**
```bash
# Read prompt from stdin (useful for git diffs, code review)
git diff | claudish --stdin --model gpt "Review these changes"
```

## Recommended Models

**Top Models for Development (verified from OpenRouter):**

1. **grok** - xAI's Grok (fast coding, visible reasoning)
   - Category: coding
   - Context: 256K
   - Best for: Quick iterations, agentic coding

2. **gemini** - Google's Gemini (state-of-the-art reasoning)
   - Category: reasoning
   - Context: 1000K
   - Best for: Complex analysis, multi-step reasoning

3. **minimax** - MiniMax M2 (high performance)
   - Category: coding
   - Context: 128K
   - Best for: General coding tasks

4. **gpt** - OpenAI's GPT-5 (advanced reasoning)
   - Category: reasoning
   - Context: 128K
   - Best for: Complex implementations, architecture decisions

5. **qwen/LATEST_VISION_MODEL** - Alibaba's Qwen (vision-language)
   - Category: vision
   - Context: 32K
   - Best for: UI/visual tasks, design implementation

**Get Latest Models:**
```bash
# Read the authoritative model aliases file (primary source)
# list_models  (claudish MCP — live catalog, 24h cache)

# Search for specific models (fetches from OpenRouter API)
claudish --models grok
claudish --models "gemini flash"

# Force immediate update from OpenRouter
claudish --models --force-update
```

## Task Complexity: Direct vs File-Based

**Simple task (direct prompt):**
```bash
claudish --model grok "create button component"
```

**Complex task (file-based with --stdin):**
```bash
# Write instructions to file, pipe via --stdin
claudish --model grok --stdin < multi-phase-workflow.md
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
claudish --model grok --stdin < /tmp/claudish-task-{timestamp}.md > /tmp/claudish-result-{timestamp}.md
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
  await Bash(`claudish --model grok --stdin < ${instructionFile}`);

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
   claudish --model grok "${featureDescription}"

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
2. Run: claudish --model gemini --stdin < ${instructionFile}
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
claudish --model grok "add error handling to api routes"
```

### Workflow 2: Complex Refactoring with GPT-5

```bash
# Advanced reasoning for complex tasks
claudish --model gpt "refactor authentication system to use OAuth2"
```

### Workflow 3: UI Implementation with Qwen (Vision)

```bash
# Vision-language model for UI tasks
claudish --model qwen/LATEST_VISION_MODEL "implement dashboard from figma design"
```

### Workflow 4: Code Review with Gemini

```bash
# State-of-the-art reasoning for thorough review
git diff | claudish --stdin --model gemini "Review these changes for bugs and improvements"
```

### Workflow 5: Multi-Model Consensus

```bash
# Run same task with multiple models
for model in "grok" "gemini" "gpt"; do
  echo "=== Testing with $model ==="
  claudish --model "$model" "find security vulnerabilities in auth.ts"
done
```

## Claudish CLI Flags Reference

### Essential Flags

| Flag | Description | Example |
|------|-------------|---------|
| `--model <model>` | OpenRouter model to use | `--model grok` |
| `--stdin` | Read prompt from stdin | `git diff \| claudish --stdin --model grok` |
| `--models` | List all models or search | `claudish --models` or `claudish --models gemini` |
| `--top-models` | ~~Show top recommended models~~ (deprecated — use the live catalog (`list_models`)) | `# list_models  (claudish MCP — live catalog, 24h cache)` |
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
my-project • grok • $0.12 • 67%
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
# list_models  (claudish MCP — live catalog, 24h cache)

# Or search via OpenRouter API
claudish --models

# Use valid model ID
claudish --model grok "task"
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

**Fast Coding:** `grok`
**Complex Reasoning:** `gemini` or `gpt`
**Vision/UI:** `qwen/LATEST_VISION_MODEL`

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
# Models resolve live via the claudish list_models MCP tool (24h cache)
# This writes to the live catalog (list_models)

# Then read the authoritative list:
# list_models  (claudish MCP — live catalog, 24h cache)

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
3. Run: claudish --model grok --stdin < /tmp/claudish-task-*.md
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
Use Claudish with grok model to implement authentication.
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
claudish --model grok "quick fix"
claudish --model gemini "complex analysis"
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
const MODELS = ["grok", "gpt"];
```

**Right:** resolve from the live catalog at call time.

```
list_models()                  → current recommended set
search_models({ query: "kimi" }) → every live variant in a family
```

### ✅ Do Accept Custom Models From Users

**Problem:** User provides a custom model ID that's not in the live catalog (`list_models`)

**Wrong (rejecting custom models):**
```typescript
const availableModels = ["grok", "gpt"];
const userModel = "custom/provider/model-123";

if (!availableModels.includes(userModel)) {
  throw new Error("Model not in my shortlist"); // ❌ DON'T DO THIS
}
```

**Right (accept any valid model ID):**
```typescript
// Claudish accepts ANY valid OpenRouter model ID, even if not in the live catalog (list_models)
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
  // Live catalog — call the claudish list_models MCP tool, never a local file.
  const models = await listModels(); // [{ id, pricing, context, capabilities }, ...]

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
4. ✅ **Explain** that the live catalog (`list_models`) contains curated model recommendations
5. ✅ **Validate format** (should contain "/") but not restrict to known models
6. ❌ **Never reject** a user's custom model with "not in my shortlist"

### ❌ Don't Skip Error Handling

**In orchestration workflows, use MCP tools with proper error handling:**

```
// Use create_session and react to channel events
create_session(model="grok", prompt=TASK, timeout_seconds=300)

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
    "grok",      // Fast initial scan
    "gemini",    // Deep analysis
    "gpt"                // Final validation
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
  // Step 1: Get available models from the live catalog (claudish list_models MCP tool)
  const models = await listModels(); // [{ id, pricing, context, capabilities }, ...]

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
1. Use faster model: `grok` or `minimax`
2. Reduce prompt size (use --stdin with concise instructions)
3. Check internet connection to OpenRouter

### Issue: High Costs

**Symptoms:** Unexpected API costs

**Solutions:**
1. Use budget-friendly models (check pricing in the live catalog (`list_models`) or with `claudish --models`)
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
