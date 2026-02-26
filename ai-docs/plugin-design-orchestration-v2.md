# Orchestration Plugin Design Document (v2)

**Plugin Name:** `orchestration`
**Version:** 0.1.0
**Purpose:** Shared multi-agent coordination and workflow orchestration patterns
**Status:** Design Phase - Revision 2
**Created:** November 22, 2025
**Revised:** November 22, 2025

---

## Executive Summary

The **orchestration plugin** extracts and centralizes sophisticated multi-agent coordination patterns from existing plugins (primarily frontend) into reusable, shareable skills. This enables all plugins to leverage proven orchestration patterns for:

- **Parallel multi-model execution** (3-5x speedup via Claudish proxy with Grok, Gemini, GPT-5)
- **Multi-agent coordination** (sequential vs parallel execution strategies)
- **Quality gates and iteration loops** (approval gates, severity classification, consensus analysis, test-driven development)
- **Error recovery** (timeout, model failure, partial success, cancellation handling)
- **TodoWrite integration** (phase tracking in complex workflows)

**Key Innovation:** Transforms hardcoded orchestration knowledge from command prompts into modular, context-efficient skills that can be loaded on-demand.

**Version Strategy:** Starting at 0.1.0 for initial release, graduating to 1.0.0 after 2-3 months of real-world validation.

---

## 1. Plugin Manifest Design

### File: `plugins/orchestration/plugin.json`

```json
{
  "name": "orchestration",
  "version": "0.1.0",
  "description": "Shared multi-agent coordination and workflow orchestration patterns for complex Claude Code workflows. Provides proven patterns for parallel execution, multi-model validation, quality gates, and phase-based orchestration.",
  "author": "MadAppGang",
  "license": "MIT",
  "homepage": "https://github.com/MadAppGang/magus",

  "tags": [
    "orchestration",
    "multi-agent",
    "workflow",
    "claudish",
    "quality-gates",
    "parallel-execution",
    "coordination",
    "grok",
    "gemini",
    "consensus",
    "error-recovery"
  ],

  "skills": [
    "multi-agent-coordination",
    "multi-model-validation",
    "quality-gates",
    "todowrite-orchestration",
    "error-recovery"
  ],

  "skillBundles": {
    "core": ["multi-agent-coordination", "quality-gates"],
    "advanced": ["multi-model-validation", "error-recovery"],
    "testing": ["quality-gates", "error-recovery"],
    "complete": ["multi-agent-coordination", "multi-model-validation", "quality-gates", "todowrite-orchestration", "error-recovery"]
  },

  "dependencies": [],

  "compatibility": {
    "claudeCode": ">=1.0.0"
  }
}
```

**Key Design Decisions:**

1. **5 skills** (added error-recovery from future enhancements)
2. **Skill bundles** - Predefined skill combinations for common use cases
3. **No agents or commands** - Pure skill plugin (orchestration knowledge only)
4. **No dependencies** - Standalone, can be used by any plugin
5. **Version 0.1.0** - Conservative initial release, mature to 1.0.0 after validation
6. **Enhanced tags** - Includes model names (grok, gemini) for discoverability

---

## 2. Skill Breakdown

### Skill 1: Multi-Agent Coordination

**File:** `plugins/orchestration/skills/multi-agent-coordination/SKILL.md`

**Purpose:** Patterns for coordinating multiple agents in complex workflows

**YAML Frontmatter:**

```yaml
---
name: multi-agent-coordination
description: Coordinate multiple agents in parallel or sequential workflows. Use when running agents simultaneously, delegating to sub-agents, switching between specialized agents, or managing agent selection. Trigger keywords - "parallel agents", "sequential workflow", "delegate", "multi-agent", "sub-agent", "agent switching", "task decomposition".
version: 1.0.0
tags: [orchestration, multi-agent, parallel, sequential, delegation, coordination]
keywords: [parallel, sequential, delegate, sub-agent, agent-switching, multi-agent, task-decomposition, coordination]
---
```

**Content Outline:**

1. **Sequential vs Parallel Execution Strategies**
   - When to run agents sequentially (dependencies exist)
   - When to run agents in parallel (independent tasks)
   - The 4-Message Pattern for true parallel execution
   - Anti-pattern: Mixing tool types breaks parallelism

2. **Agent Selection Patterns**
   - Task type detection (API/UI/Mixed/Testing/Review)
   - Agent capability matching
   - Intelligent agent switching (ui-developer vs ui-developer-codex)
   - Fallback strategies when preferred agent unavailable

3. **Sub-Agent Delegation**
   - Task tool usage for delegation
   - File-based instruction patterns (context isolation)
   - Brief summary returns (avoid context pollution)
   - Proxy mode invocation

4. **Context Window Management**
   - When to delegate vs execute in main context
   - File-based instructions to avoid pollution
   - Summary-only responses from sub-agents
   - Context size estimation strategies

**Extracted From:**
- `/implement` command (task detection, agent selection)
- `/validate-ui` command (agent switching logic)
- `/review` command (parallel execution patterns)

---

### Skill 2: Multi-Model Validation

**File:** `plugins/orchestration/skills/multi-model-validation/SKILL.md`

**Purpose:** Patterns for running multiple AI models in parallel via Claudish proxy

**YAML Frontmatter:**

```yaml
---
name: multi-model-validation
description: Run multiple AI models in parallel for 3-5x speedup. Use when validating with Grok, Gemini, GPT-5, DeepSeek, or Claudish proxy for code review, consensus analysis, or multi-expert validation. Trigger keywords - "grok", "gemini", "gpt-5", "deepseek", "claudish", "multiple models", "parallel review", "external AI", "consensus", "multi-model".
version: 1.0.0
tags: [orchestration, claudish, parallel, consensus, multi-model, grok, gemini, external-ai]
keywords: [grok, gemini, gpt-5, deepseek, claudish, parallel, consensus, multi-model, external-ai, proxy, openrouter]
---
```

**Content Outline:**

1. **The 4-Message Pattern (MANDATORY)**
   - Message 1: Preparation (Bash only - create dirs, validate inputs)
   - Message 2: Parallel Execution (ONLY Task calls - all models simultaneously)
   - Message 3: Auto-Consolidation (launch consolidation agent automatically)
   - Message 4: Present Results (user-facing summary)
   - WHY: Mixing tools breaks parallelism - strict sequence required

2. **Parallel Execution Architecture**
   - Single message with multiple Task invocations
   - Task separation with `---` delimiter
   - Independent tasks (no dependencies)
   - Unique output files per task
   - Wait for all before consolidation
   - Performance: 15min → 5min (3-5x speedup)

3. **Proxy Mode Implementation**
   - PROXY_MODE directive in agent prompts
   - Blocking execution (synchronous claudish calls)
   - Capture full output, write to file
   - Return brief summary only (2-5 sentences)
   - NEVER return full output to orchestrator

4. **Cost Estimation and Transparency**
   - Input/output token separation
   - Input: code lines × 1.5 (context + instructions)
   - Output: 2000-4000 tokens (varies by complexity)
   - Output costs 3-5x more than input
   - Range-based estimates (min-max)
   - User approval before execution

5. **Auto-Consolidation Logic**
   - Automatic trigger after N ≥ 2 reviews
   - Don't wait for user prompt
   - Launch consolidation agent automatically
   - Pass all review file paths
   - Present consolidated results

6. **Consensus Analysis**
   - Unanimous (100% agreement) - VERY HIGH confidence
   - Strong Consensus (67-99%) - HIGH confidence
   - Majority (50-66%) - MEDIUM confidence
   - Divergent (single reviewer) - LOW confidence
   - Model agreement matrix
   - Simplified keyword-based matching (v1.0)

**Extracted From:**
- `/review` command (complete parallel review orchestration)
- `/validate-ui` command (parallel designer validation)
- `CLAUDE.md` Parallel Multi-Model Execution Protocol
- `shared/skills/claudish-usage` (Claudish integration patterns)

---

### Skill 3: Quality Gates

**File:** `plugins/orchestration/skills/quality-gates/SKILL.md`

**Purpose:** Patterns for approval gates, iteration loops, and quality validation

**YAML Frontmatter:**

```yaml
---
name: quality-gates
description: Implement quality gates, user approval, iteration loops, and test-driven development. Use when validating with users, implementing feedback loops, classifying issue severity, running test-driven loops, or building multi-iteration workflows. Trigger keywords - "approval", "user validation", "iteration", "feedback loop", "severity", "test-driven", "TDD", "quality gate", "consensus".
version: 1.0.0
tags: [orchestration, quality-gates, approval, iteration, feedback, severity, test-driven, TDD]
keywords: [approval, validation, iteration, feedback-loop, severity, test-driven, TDD, quality-gate, consensus, user-approval]
---
```

**Content Outline:**

1. **User Approval Gates**
   - When to ask for approval (cost gates, quality gates, final validation)
   - How to present approval options (clear choices, context)
   - Graceful exit on cancellation
   - Approval bypasses for automated workflows

2. **Iteration Loop Patterns**
   - Max iteration limits (typically 10 for automated)
   - Exit criteria (PASS assessment, user approval, max iterations)
   - Progress tracking ("Iteration X/Y complete")
   - Iteration history documentation

3. **Issue Severity Classification**
   - CRITICAL: Must fix immediately (blocks functionality, security issues)
   - HIGH: Should fix soon (major bugs, performance issues)
   - MEDIUM: Should fix (minor bugs, code quality)
   - LOW: Nice to have (polish, suggestions)
   - Severity-based prioritization

4. **Multi-Reviewer Consensus**
   - Issues flagged by ALL reviewers → Highest priority
   - Issues flagged by MAJORITY → High priority
   - Issues flagged by SINGLE reviewer → Consider/Optional
   - Consensus levels: Unanimous/Strong/Majority/Divergent

5. **Feedback Loop Implementation**
   - User reports issues → Extract specific feedback
   - Launch fixing agent with user feedback
   - Re-run validation after fixes
   - Loop until user approves
   - Max feedback rounds (typically 5)

6. **Test-Driven Development Loop Pattern**
   - **When to Use:** After implementing code, before code review
   - **Pattern:**
     1. Write tests first (or generate from requirements)
     2. Run tests (e.g., `bun test`, `npm test`)
     3. If tests fail:
        - Analyze failure (test bug vs implementation bug)
        - Launch test-architect to determine root cause
        - If TEST_ISSUE: Fix test and re-run
        - If IMPLEMENTATION_ISSUE: Provide structured feedback to developer
        - Re-launch developer with test failure feedback
        - Loop until all tests pass (max 10 iterations)
     4. If tests pass: Proceed to code review
   - **Example from /implement PHASE 2.5 (API workflows):**
     ```
     For each test failure:
       1. Run: bun test
       2. Capture output
       3. Launch: test-architect (analyze failure)
       4. If test is wrong: Fix test
       5. If implementation is wrong: Fix code
       6. Re-run tests
       7. Loop until all pass (max 10 iterations)
     ```
   - **Benefits:**
     - Catches bugs early (before code review)
     - Ensures test quality (test bugs caught by test-architect)
     - Automated quality assurance (no manual testing needed)
     - Fast feedback loop (seconds vs minutes)

**Extracted From:**
- `/review` command (consensus analysis, user approval for costs)
- `/validate-ui` command (mandatory user validation, feedback loops)
- `/implement` command (quality gates between phases, user acceptance, PHASE 2.5 test-driven loop)

---

### Skill 4: TodoWrite Orchestration

**File:** `plugins/orchestration/skills/todowrite-orchestration/SKILL.md`

**Purpose:** Patterns for using TodoWrite in complex multi-phase workflows

**YAML Frontmatter:**

```yaml
---
name: todowrite-orchestration
description: Track progress in multi-phase workflows with TodoWrite. Use when orchestrating 5+ phase commands, managing iteration loops, tracking parallel tasks, or providing real-time progress visibility. Trigger keywords - "phase tracking", "progress", "workflow", "multi-step", "multi-phase", "todo", "tracking", "status".
version: 1.0.0
tags: [orchestration, todowrite, progress, tracking, workflow, multi-phase]
keywords: [phase-tracking, progress, workflow, multi-step, multi-phase, todo, tracking, status, visibility]
---
```

**Content Outline:**

1. **Phase Initialization**
   - Create TodoWrite list BEFORE starting workflow (step 0)
   - List all phases upfront (provides user visibility)
   - Example: 10 tasks for 5-phase workflow
   - Include sub-tasks within phases

2. **Task Granularity Guidelines**
   - One task per significant operation
   - Multi-step phases: Break into 2-3 sub-tasks
   - Example: "PHASE 1: Ask user" (1 task), "PHASE 1: Gather data" (1 task)
   - Avoid too many tasks (max 15-20 for readability)

3. **Status Transitions**
   - pending → in_progress (when starting task)
   - in_progress → completed (immediately after finishing)
   - NEVER batch completions
   - Exactly ONE task in_progress at a time

4. **Real-Time Progress Tracking**
   - Update TodoWrite as work progresses
   - Mark completed immediately (not at phase end)
   - Add new tasks if discovered during execution
   - User can see current progress at any time

5. **Iteration Loop Tracking**
   - Create task per iteration ("Iteration 1/10", "Iteration 2/10")
   - Mark iteration complete when done
   - Track total iterations vs max limit
   - Clear progress visibility

**Extracted From:**
- `/review` command (10-task workflow, phase-based tracking)
- `/implement` command (8-phase workflow with sub-tasks)
- `/validate-ui` command (iteration tracking, user feedback rounds)

---

### Skill 5: Error Recovery

**File:** `plugins/orchestration/skills/error-recovery/SKILL.md`

**Purpose:** Patterns for handling failures in multi-agent workflows

**YAML Frontmatter:**

```yaml
---
name: error-recovery
description: Handle errors, timeouts, and failures in multi-agent workflows. Use when dealing with external model timeouts, API failures, partial success, user cancellation, or graceful degradation. Trigger keywords - "error", "failure", "timeout", "retry", "fallback", "cancelled", "graceful degradation", "recovery", "partial success".
version: 1.0.0
tags: [orchestration, error-handling, retry, fallback, timeout, recovery]
keywords: [error, failure, timeout, retry, fallback, graceful-degradation, cancellation, recovery, partial-success, resilience]
---
```

**Content Outline:**

1. **Timeout Handling**
   - **Scenario:** External model takes >30s with no response
   - **Detection:** Monitor claudish execution time, set timeout limits
   - **Recovery:**
     1. Log timeout event
     2. Notify user: "Model X timed out after 30s"
     3. Offer retry or skip option
     4. If retry: Increase timeout to 60s
     5. If skip: Continue with remaining models
   - **Graceful Degradation:** Proceed with N-1 models if one times out
   - **Example:**
     ```
     if (executionTime > 30000 && !modelResponded) {
       log("Timeout: x-ai/grok-code-fast-1 after 30s");
       askUser("Retry with 60s timeout or skip this model?");
       if (retry) { executeWithTimeout(60000); }
       else { skipModel(); proceedWithRemaining(); }
     }
     ```

2. **API Failure Recovery**
   - **Scenarios:**
     - 401 Unauthorized (invalid API key)
     - 500 Internal Server Error (model service down)
     - Network errors (connection timeout)
     - Rate limiting (429 Too Many Requests)
   - **Recovery Strategies:**
     - 401: Prompt user to check OPENROUTER_API_KEY
     - 500: Retry once after 5s delay, then skip
     - Network: Retry up to 3 times with exponential backoff
     - 429: Wait for rate limit reset (check Retry-After header)
   - **Graceful Degradation:** Continue with embedded Claude if all external models fail
   - **Example:**
     ```
     try {
       result = await claudish(model, prompt);
     } catch (error) {
       if (error.status === 401) {
         notifyUser("Invalid OpenRouter API key. Check .env");
         skipExternalModels();
         fallbackToEmbeddedClaude();
       } else if (error.status === 500) {
         await sleep(5000);
         result = await retryOnce(claudish, model, prompt);
         if (failed) { skipModel(); }
       }
     }
     ```

3. **Partial Success Strategies**
   - **Scenario:** 2 of 4 models complete successfully, 2 fail
   - **Strategy:**
     1. Track success/failure for each model
     2. If N ≥ 2 successful: Proceed with consolidation
     3. If N < 2: Offer user choice (retry failures or abort)
     4. Consolidation adapts to N models (not assuming all 4)
   - **Communication:**
     - "2/4 models completed successfully"
     - "Proceeding with consolidation using 2 reviews"
     - "Grok and Gemini failed - see logs for details"
   - **Example:**
     ```
     const results = await Promise.allSettled(modelTasks);
     const successful = results.filter(r => r.status === 'fulfilled');

     if (successful.length >= 2) {
       notifyUser(`${successful.length}/4 models completed`);
       consolidateReviews(successful.map(r => r.value));
     } else {
       askUser("Only 1 model succeeded. Retry failures or abort?");
     }
     ```

4. **User Cancellation Handling (Ctrl+C)**
   - **Scenario:** User presses Ctrl+C during long-running workflow
   - **Cleanup Strategy:**
     1. Catch cancellation signal
     2. Stop all running processes gracefully
     3. Save partial results to files
     4. Log what was completed vs what was cancelled
     5. Notify user: "Workflow cancelled. Partial results saved to X"
   - **Resumable Workflows:**
     - Save state to `.claude/workflow-state.json`
     - Offer resume option on next invocation
     - Skip completed phases, resume from last checkpoint
   - **Example:**
     ```
     process.on('SIGINT', async () => {
       log("User cancelled workflow (Ctrl+C)");
       await stopAllAgents();
       await savePartialResults();
       notifyUser("Cancelled. Partial results in ai-docs/partial-review.md");
       process.exit(0);
     });
     ```

5. **Claudish Not Installed**
   - **Scenario:** User requests multi-model review but `claudish` CLI not installed
   - **Detection:** Run `which claudish` or `claudish --version`
   - **Recovery:**
     1. Detect missing claudish
     2. Notify user with installation instructions
     3. Offer fallback to embedded Claude Sonnet only
   - **Example:**
     ```
     const hasClaudish = await checkCommand('claudish --version');
     if (!hasClaudish) {
       notifyUser("Claudish CLI not found. Install: npm install -g claudish");
       notifyUser("Falling back to embedded Claude Sonnet for review.");
       runEmbeddedReviewOnly();
     }
     ```

6. **Out of OpenRouter Credits**
   - **Scenario:** External model API call fails due to insufficient credits
   - **Detection:** API returns 402 Payment Required or credit error message
   - **Recovery:**
     1. Log credit exhaustion
     2. Notify user: "OpenRouter credits exhausted. Add credits at openrouter.ai"
     3. Skip all external models
     4. Fallback to embedded Claude
   - **Example:**
     ```
     if (error.status === 402 || error.message.includes('credits')) {
       notifyUser("OpenRouter credits exhausted. Falling back to Claude.");
       skipAllExternalModels();
       runEmbeddedReviewOnly();
     }
     ```

7. **Retry Strategies**
   - **Exponential Backoff:**
     - 1st retry: Wait 1s
     - 2nd retry: Wait 2s
     - 3rd retry: Wait 4s
     - Max 3 retries
   - **When to Retry:**
     - Network errors (transient)
     - 500 errors (service temporarily down)
     - Rate limiting (wait for reset)
   - **When NOT to Retry:**
     - 401 errors (bad credentials)
     - 404 errors (model not found)
     - User cancellation
   - **Example:**
     ```
     async function retryWithBackoff(fn, maxRetries = 3) {
       for (let i = 0; i < maxRetries; i++) {
         try {
           return await fn();
         } catch (error) {
           if (!isRetriable(error) || i === maxRetries - 1) throw error;
           await sleep(Math.pow(2, i) * 1000);
         }
       }
     }
     ```

**Extracted From:**
- `/review` command error handling (external model failures)
- `/implement` command PHASE 2.5 (test-driven loop error recovery)
- Production experience with Claudish proxy failures
- Multi-model validation resilience requirements

---

## 3. Content Extraction Map

### From `/review` Command → Orchestration Skills

| Source Section | Target Skill | Specific Content |
|---------------|-------------|------------------|
| `<parallel_execution_requirement>` | multi-model-validation | 4-Message Pattern, Task separation, speedup rationale |
| `<key_design_innovation>` | multi-model-validation | Parallel execution architecture, performance comparison |
| `<cost_estimation>` | multi-model-validation | Input/output token separation, range-based estimates |
| `<consensus_algorithm>` | multi-model-validation | Keyword-based matching, confidence levels |
| `<todowrite_requirement>` | todowrite-orchestration | 10-task initialization, phase tracking |
| Phase 2 (Model Selection) | quality-gates + error-recovery | User approval for costs, graceful degradation when claudish missing |
| Phase 3 (Parallel Execution) | error-recovery | Timeout handling, partial success strategies |
| Phase 4 (Consolidate) | multi-model-validation | Auto-consolidation trigger, consensus analysis |

### From `/validate-ui` Command → Orchestration Skills

| Source Section | Target Skill | Specific Content |
|---------------|-------------|------------------|
| Step 3.1 (Parallel Designer Launch) | multi-agent-coordination | Parallel agent execution, single message pattern |
| Step 3.2 (Consolidate Reviews) | multi-model-validation | Multi-source consensus, issue prioritization |
| Step 3.4 (Loop Status) | quality-gates | Iteration limits, exit criteria |
| Phase 3.5 (User Validation) | quality-gates | Mandatory user gate, feedback loops |
| User Feedback Handling | quality-gates | User-reported issues, fixing agent delegation |

### From `/implement` Command → Orchestration Skills

| Source Section | Target Skill | Specific Content |
|---------------|-------------|------------------|
| Task Detection Logic | multi-agent-coordination | API/UI/Mixed detection, agent selection |
| Multi-Agent Orchestration | multi-agent-coordination | Sequential delegation, phase-based workflows |
| PHASE 2.5 (Test-Driven Loop) | quality-gates + error-recovery | Test-architect loop, failure analysis, retry logic |
| Quality Gates | quality-gates | User approval between phases, acceptance criteria |
| Phase Tracking | todowrite-orchestration | 8-phase breakdown, sub-task management |

### From `CLAUDE.md` Parallel Protocol → Orchestration Skills

| Source Section | Target Skill | Specific Content |
|---------------|-------------|------------------|
| 4-Message Pattern | multi-model-validation | Complete protocol documentation |
| Anti-Pattern 1 (Mixed Tools) | multi-model-validation | Why mixing fails, correct pattern |
| Proxy Mode: Blocking Execution | multi-model-validation | Synchronous claudish calls, output capture |
| Auto-Consolidation Logic | multi-model-validation | N ≥ 2 trigger, automatic execution |

### From `shared/claudish-usage` → Orchestration Skills

| Source Section | Target Skill | Specific Content |
|---------------|-------------|------------------|
| File-Based Sub-Agent Pattern | multi-agent-coordination | Context isolation, summary returns |
| Agent Selection Guide | multi-agent-coordination | Task type → agent matching matrix |
| Sub-Agent Delegation Pattern | multi-agent-coordination | Task tool usage, prompt structure |

---

## 4. Integration Patterns

### How Skills Work Together

**Scenario 1: Multi-Model Code Review Workflow**

```
Skills Used: multi-model-validation + quality-gates + todowrite-orchestration + error-recovery

Phase 1: Initialize TodoWrite (todowrite-orchestration)
  ✓ Create 10-task list before starting

Phase 2: Cost Approval Gate (quality-gates)
  ✓ Present cost estimates with input/output separation
  ✓ Get user approval before proceeding
  ✓ Handle rejection gracefully (error-recovery)

Phase 3: Parallel Review Execution (multi-model-validation + error-recovery)
  ✓ Follow 4-Message Pattern
  ✓ Launch all external models in single message
  ✓ Handle timeouts (error-recovery)
  ✓ Handle API failures (error-recovery)
  ✓ Handle partial success (error-recovery)
  ✓ Track progress with TodoWrite

Phase 4: Auto-Consolidation (multi-model-validation)
  ✓ Trigger automatically when N ≥ 2 reviews complete
  ✓ Apply consensus analysis
  ✓ Prioritize by agreement level

Phase 5: Present Results (quality-gates)
  ✓ Show prioritized issues
  ✓ Link to detailed reports
```

**Scenario 2: Multi-Agent UI Validation Workflow**

```
Skills Used: multi-agent-coordination + quality-gates + todowrite-orchestration + error-recovery

Phase 1: Agent Selection (multi-agent-coordination)
  ✓ Detect task type (UI implementation)
  ✓ Choose designer + ui-developer agents
  ✓ Optional: external model validation

Phase 2: Parallel Validation (multi-agent-coordination + error-recovery)
  ✓ Launch designer and designer-codex in parallel
  ✓ Single message, two Task calls
  ✓ Handle agent failures (error-recovery)
  ✓ Wait for both to complete

Phase 3: Iteration Loop (quality-gates + error-recovery)
  ✓ Check designer assessment
  ✓ If not PASS and < 10 iterations: loop
  ✓ Track with TodoWrite
  ✓ Handle user cancellation (error-recovery)

Phase 4: User Validation Gate (quality-gates)
  ✓ MANDATORY manual validation
  ✓ Collect user feedback if issues found
  ✓ Loop until user approves
```

**Scenario 3: Complex Implementation Workflow with Test-Driven Development**

```
Skills Used: all 5 skills together

Phase 1: Plan (multi-agent-coordination)
  ✓ Delegate to architect agent
  ✓ File-based instructions (context isolation)

Phase 2: Implement (multi-agent-coordination + todowrite-orchestration)
  ✓ Delegate to developer agent
  ✓ Track sub-tasks with TodoWrite

Phase 2.5: Test-Driven Feedback Loop (quality-gates + error-recovery)
  ✓ Write tests (test-architect)
  ✓ Run tests (bun test)
  ✓ If tests fail:
    - Analyze failure (test-architect)
    - Fix implementation (developer)
    - Handle test execution errors (error-recovery)
    - Loop until all pass (max 10 iterations)
  ✓ If tests pass: Proceed to code review

Phase 3: Review (multi-model-validation + quality-gates + error-recovery)
  ✓ Parallel multi-model code review
  ✓ Consensus analysis
  ✓ User approval gate
  ✓ Handle model failures gracefully

Phase 4: Accept (quality-gates)
  ✓ User validation
  ✓ Iteration loop if issues
  ✓ Final acceptance gate
```

### Skill Loading Strategy

**When to Load Which Skills:**

| Workflow Type | Load Skills |
|--------------|-------------|
| Simple single-agent task | None (not needed) |
| Multi-agent sequential workflow | `multi-agent-coordination` + `todowrite-orchestration` |
| Multi-model validation | `multi-model-validation` + `quality-gates` + `todowrite-orchestration` + `error-recovery` |
| Complex multi-phase workflow | All 5 skills |
| User feedback loop | `quality-gates` + `todowrite-orchestration` |
| Parallel execution | `multi-agent-coordination` + `multi-model-validation` + `error-recovery` |
| Test-driven development | `quality-gates` + `error-recovery` + `todowrite-orchestration` |

---

## 5. Installation and Usage Guide

### 5.1 Installation Strategy

**Option 1: Dependency Declaration (Recommended)**

Plugins declare orchestration as a dependency:

```json
// plugins/frontend/plugin.json
{
  "name": "frontend",
  "version": "3.7.0",
  "dependencies": {
    "orchestration@magus": "^0.1.0"
  }
}
```

**How It Works:**
1. User installs frontend plugin
2. Claude Code checks dependencies
3. Automatically installs orchestration plugin
4. Skills become available to frontend agents/commands

**Option 2: Explicit Installation**

Users install orchestration plugin directly:

```bash
/plugin install orchestration@magus
```

**Use Case:** Users want orchestration patterns for custom agents/workflows

**Option 3: Global Installation**

Install orchestration globally (available to all projects):

```bash
# Add marketplace (if not already added)
/plugin marketplace add MadAppGang/magus

# Install plugin globally
/plugin install orchestration@magus --global
```

---

### 5.2 Using Skills in Agents/Commands

**In Agent Prompts:**

```markdown
---
name: my-orchestrator
description: Custom orchestration command
model: sonnet
skills: orchestration:multi-model-validation, orchestration:quality-gates
---

<instructions>
  <workflow>
    Follow the 4-Message Pattern from the multi-model-validation skill:

    - Message 1: Preparation (Bash only)
    - Message 2: Parallel execution (Task calls only)
    - Message 3: Auto-consolidation
    - Message 4: Present results

    Use quality-gates skill for user approval before expensive operations.
  </workflow>
</instructions>
```

**In Command Prompts:**

```markdown
---
description: My multi-phase workflow
allowed-tools: Task, Bash, TodoWrite, AskUserQuestion
skills: orchestration:todowrite-orchestration, orchestration:multi-agent-coordination
---

Before starting, initialize TodoWrite with all workflow phases per todowrite-orchestration skill.

For each agent delegation, follow multi-agent-coordination patterns:
- File-based instructions for context isolation
- Summary-only responses
- Appropriate agent selection by task type
```

**Skill Reference Syntax:**

- `orchestration:multi-model-validation` - Load specific skill
- `orchestration:*` - Load all orchestration skills (for complex workflows)
- `orchestration:core` - Load core skill bundle (multi-agent-coordination + quality-gates)
- `orchestration:advanced` - Load advanced skill bundle (multi-model-validation + error-recovery)

---

### 5.3 Skill Requirements in Frontmatter

**Skill Dependency Declaration:**

Commands and agents can declare skill requirements:

```yaml
---
name: my-review-command
description: Multi-model code review
skills_required: orchestration:multi-model-validation>=1.0.0, orchestration:error-recovery>=1.0.0
skills_optional: orchestration:quality-gates>=1.0.0
---
```

**Behavior:**

- **skills_required**: Command fails with error if skill missing or version incompatible
- **skills_optional**: Command continues without skill, logs warning

**Error Messages:**

```
❌ ERROR: Required skill orchestration:multi-model-validation>=1.0.0 not found
   Install orchestration plugin: /plugin install orchestration@magus

⚠️ WARNING: Optional skill orchestration:quality-gates>=1.0.0 not found
   Some features may be unavailable
```

---

### 5.4 Graceful Degradation Strategy

**When Skill Missing:**

1. **skills_required** → Abort with error message
2. **skills_optional** → Continue without skill, notify user

**When Skill Version Incompatible:**

1. Check version compatibility (semantic versioning)
2. If major version mismatch (e.g., 1.x vs 2.x) → Error
3. If minor version mismatch (e.g., 1.2 vs 1.5) → Warning
4. If patch version mismatch (e.g., 1.0.1 vs 1.0.3) → Silent upgrade

**Example:**

```
User has orchestration v0.1.0
Command requires orchestration:multi-model-validation>=1.0.0

Result: ❌ ERROR - Major version mismatch
        Installed: 0.1.0
        Required: >=1.0.0
        Action: Upgrade orchestration plugin
```

---

### 5.5 Skill Loading Mechanics

**How Skills Load:**

Commands and agents reference skills in YAML frontmatter:

```yaml
---
name: my-review-command
description: Multi-model code review
skills: orchestration:multi-model-validation, orchestration:quality-gates
---
```

**Loading Process:**

1. **Claude Code parses frontmatter** when command/agent is invoked
2. **Resolves skill references** to file paths:
   - `orchestration:multi-model-validation` → `plugins/orchestration/skills/multi-model-validation/SKILL.md`
3. **Reads skill content** from SKILL.md files
4. **Injects skill content** into system prompt before agent/command instructions
5. **Claude has access** to skill knowledge during execution

**Order of Injection:**

```
System Prompt Structure:
1. Base Claude Code instructions
2. Skill content (in order listed)
3. Agent/Command instructions
4. User request
```

**Example Skill Injection:**

```markdown
# System Prompt for /review command

[Base Claude Code Instructions]

--- SKILL: orchestration:multi-model-validation ---
[Full content of multi-model-validation/SKILL.md]
--- END SKILL ---

--- SKILL: orchestration:quality-gates ---
[Full content of quality-gates/SKILL.md]
--- END SKILL ---

[/review command instructions]

[User request: "Review my changes with Grok and Gemini"]
```

**Error Handling:**

**Scenario 1: Skill File Missing**

```
⚠️ WARNING: Skill orchestration:multi-model-validation not found
   Expected: plugins/orchestration/skills/multi-model-validation/SKILL.md
   Action: Command continues without skill (graceful degradation)
   User Message: "⚠️ Multi-model validation patterns unavailable. Install orchestration plugin."
```

**Scenario 2: Skill Load Failure (Read Error)**

```
❌ ERROR: Failed to load skill orchestration:multi-model-validation
   Reason: Permission denied reading SKILL.md
   Action: Log error, notify user, continue without skill
   User Message: "⚠️ Error loading orchestration skills. Check plugin installation."
```

**Scenario 3: Invalid Skill Reference**

```
❌ ERROR: Invalid skill reference "orchestration:nonexistent-skill"
   Available skills: multi-agent-coordination, multi-model-validation, quality-gates, todowrite-orchestration, error-recovery
   Action: Skip invalid reference, load valid skills, notify user
   User Message: "⚠️ Unknown skill 'nonexistent-skill' - skipped"
```

**Example 1: Single Skill Load**

```yaml
# Command frontmatter
skills: orchestration:todowrite-orchestration

# Result: Only todowrite-orchestration patterns injected
# File loaded: plugins/orchestration/skills/todowrite-orchestration/SKILL.md
```

**Example 2: Multiple Skills**

```yaml
# Command frontmatter
skills: orchestration:multi-model-validation, orchestration:quality-gates, orchestration:todowrite-orchestration

# Result: 3 skills injected in order
# Files loaded:
#   1. plugins/orchestration/skills/multi-model-validation/SKILL.md
#   2. plugins/orchestration/skills/quality-gates/SKILL.md
#   3. plugins/orchestration/skills/todowrite-orchestration/SKILL.md
```

**Example 3: All Orchestration Skills (Wildcard)**

```yaml
# Command frontmatter
skills: orchestration:*

# Result: All 5 skills injected
# Expands to: multi-agent-coordination, multi-model-validation, quality-gates, todowrite-orchestration, error-recovery
```

**Example 4: Skill Bundles**

```yaml
# Command frontmatter
skills: orchestration:core

# Result: Loads core bundle (multi-agent-coordination + quality-gates)
# Defined in plugin.json skillBundles.core

# Other bundles:
# orchestration:advanced → multi-model-validation + error-recovery
# orchestration:testing → quality-gates + error-recovery
# orchestration:complete → all 5 skills
```

**Skill Loading Performance:**

- Each skill: ~1000-1500 lines (1500-2500 tokens)
- All 5 skills: ~5000-7500 lines (~10000 tokens)
- Recommendation: Load only needed skills to optimize context usage
- Use bundles for common combinations

**Caching:**

- Skills are read once per command invocation
- Content cached in memory for duration of execution
- No persistent caching across invocations (ensures fresh content)

---

## 6. Migration Strategy and Backward Compatibility

### 6.1 Migration Path

**Phase 1: Create Orchestration Plugin (v0.1.0) - Week 1**
- Create plugin structure
- Write 5 skills with extracted content
- Add examples and documentation
- Test skills in isolation
- **Rollback Strategy:** Delete plugin, no dependencies yet

**Phase 2: Add Dependency to Frontend Plugin (v3.7.0) - Week 2**
- Update `plugins/frontend/plugin.json` to depend on orchestration v0.1.0
- Update command prompts to reference skills (optional, for clarity)
- Keep existing inline documentation (backward compatible)
- Release frontend v3.7.0 with dependency
- **Rollback Strategy:** Revert frontend to v3.6.0, remove dependency

**Phase 3: Gradual Skill References (v3.8.0+) - Weeks 3-4**
- Replace inline orchestration patterns with skill references
- Example: `/review` command → Reference `multi-model-validation` skill
- Remove duplicate content from command prompts
- Keep critical information inline (don't over-abstract)
- **Rollback Strategy:** Keep v3.7.0 release available, provide downgrade path

**Phase 4: Add to Other Plugins - Weeks 5-8**
- Bun backend plugin (v1.3.0) - Add dependency
- Code analysis plugin (v1.2.0) - Add dependency
- Custom user plugins - Can opt-in
- **Rollback Strategy:** Independent rollback per plugin

**Phase 5: Graduate to v1.0.0 - Month 3**
- After 2-3 months of real-world usage
- Collect feedback and iterate
- Address any discovered issues
- Bump to v1.0.0 (stable release)
- **Go/No-Go Gates:**
  - ✅ 100+ installations via dependencies
  - ✅ 0 CRITICAL bugs reported
  - ✅ Positive user feedback
  - ✅ All 3 plugins (frontend, bun, code-analysis) using successfully

---

### 6.2 Backward Compatibility Guarantees

**Existing Commands Continue Working:**

✅ **Frontend plugin users** - No breaking changes
- Commands still work without skill references
- Inline documentation preserved
- Skills provide additional context (not replacement)

✅ **Skill Loading is Additive**
- Loading orchestration skills adds knowledge
- Does NOT remove existing command instructions
- Acts as reference documentation

✅ **No Required Changes**
- Users don't need to modify anything
- Plugin dependency auto-installs orchestration
- Existing workflows unchanged

---

### 6.3 Version Coupling Mitigation

**Problem:** Frontend v3.7.0 depends on orchestration v0.1.0. If orchestration updates to v0.2.0, does frontend need to release?

**Solution 1: Flexible Versioning (Implemented)**

```json
// plugins/frontend/plugin.json
{
  "dependencies": {
    "orchestration@magus": "^0.1.0"
  }
}
```

**Semantic Versioning:**
- `^0.1.0` allows: 0.1.0, 0.1.1, 0.1.2, ... 0.1.x (patches)
- `^0.1.0` allows: 0.2.0, 0.3.0, ... 0.x.y (minors during 0.x phase)
- `^0.1.0` BLOCKS: 1.0.0 (major version change)

**After graduating to 1.0.0:**
- `^1.0.0` allows: 1.0.x, 1.1.x, 1.2.x, ... 1.x.y
- `^1.0.0` BLOCKS: 2.0.0 (breaking changes)

**Solution 2: Skill Bundles (Implemented in plugin.json)**

```json
// plugins/orchestration/plugin.json
{
  "skillBundles": {
    "core": ["multi-agent-coordination", "quality-gates"],
    "advanced": ["multi-model-validation", "error-recovery"],
    "testing": ["quality-gates", "error-recovery"],
    "complete": ["multi-agent-coordination", "multi-model-validation", "quality-gates", "todowrite-orchestration", "error-recovery"]
  }
}
```

**Benefits:**
- Plugins reference bundles, not individual skills
- Orchestration can reorganize skills within bundles (non-breaking)
- Example: `skills: orchestration:core` works even if skills are renamed

**Solution 3: Skill Requirements in Frontmatter (New)**

```yaml
# Command declares which skills it REQUIRES vs OPTIONAL
skills_required: orchestration:multi-model-validation>=1.0.0
skills_optional: orchestration:error-recovery>=1.0.0
```

**Benefits:**
- Clear dependency contract
- Graceful degradation when optional skill missing
- Version compatibility checking

**Solution 4: Deprecation Policy**

**When removing or renaming a skill:**

1. **v1.0.0:** Add new skill, mark old skill as deprecated
2. **v1.1.0:** Both skills exist (transition period)
3. **v2.0.0:** Remove deprecated skill (major version bump)

**Example:**

```
v1.0.0: multi-model-validation (current)
v1.5.0: Add multi-model-consensus (new), deprecate multi-model-validation
v1.6.0: Both exist, migration guide provided
v2.0.0: Remove multi-model-validation, only multi-model-consensus remains
```

**Dependent plugins get time to migrate between v1.5.0 and v2.0.0**

---

### 6.4 What NOT to Migrate

**Keep in Command Prompts:**

1. **Command-specific logic** - Don't extract
2. **Critical constraints** - Keep inline for visibility
3. **Mission statements** - Command identity stays in command
4. **Tool restrictions** - Orchestrators must see "no Write/Edit"
5. **Phase-specific steps** - Detailed workflow stays in command

**Extract to Skills:**

1. **Reusable patterns** - 4-Message Pattern, consensus analysis
2. **General guidance** - When to use parallel vs sequential
3. **Best practices** - Cost estimation formulas, severity classification
4. **Common anti-patterns** - Mixing tools breaks parallelism
5. **Integration examples** - How to use TodoWrite in loops

---

### 6.5 Versioning Strategy

**Orchestration Plugin:**
- **v0.1.0** - Initial release (5 skills)
- **v0.2.0** - Add new pattern within existing skill (non-breaking)
- **v0.5.0** - Add 6th skill (non-breaking)
- **v1.0.0** - Graduate to stable after 2-3 months (requires go/no-go gates)
- **v1.1.0** - Add new skill (non-breaking)
- **v2.0.0** - Breaking changes to skill structure (rare, requires migration guide)

**Dependent Plugins:**
- Use `^0.1.0` for 0.x phase (flexible updates, expect some instability)
- Use `^1.0.0` after graduation (flexible minor/patch updates)
- Use `~1.0.0` for patch-only updates (conservative)
- Use `1.0.0` for exact version lock (not recommended, blocks updates)

**Example:**

```json
{
  "dependencies": {
    "orchestration@magus": "^0.1.0"
  }
}
```

This allows:
- 0.1.x, 0.2.x, 0.3.x (during 0.x phase)
- 1.x.y (after graduating to 1.0.0)
- Blocks 2.0.0 (breaking changes)

---

## 7. Example Workflows Using Skills

### Example 1: Multi-Model Code Review

**User Request:** "Review my changes with multiple AI models"

**Orchestrator:** `/review` command

**Skills Loaded:**
- `multi-model-validation` (4-Message Pattern, parallel execution)
- `quality-gates` (cost approval, consensus analysis)
- `todowrite-orchestration` (10-task workflow tracking)
- `error-recovery` (timeout, API failure, partial success handling)

**Workflow:**

```
STEP 0: Initialize TodoWrite (todowrite-orchestration pattern)
  Tasks: [Phase 1 ask, Phase 1 gather, Phase 2 models, Phase 2 approval, ...]

STEP 1: Determine Review Target
  - Ask user what to review
  - Run git diff for unstaged changes
  - Write context to ai-docs/code-review-context.md
  - Mark Phase 1 complete

STEP 2: Model Selection and Cost Approval (quality-gates pattern + error-recovery)
  - Check if claudish installed (error-recovery)
  - If missing: Notify user, fallback to embedded Claude only
  - Query claudish --list-models --json
  - Present options (up to 9 external + 1 embedded)
  - Calculate costs: INPUT (code × 1.5) + OUTPUT (2000-4000 range)
  - Ask user approval for estimated cost
  - Mark Phase 2 complete

STEP 3: Parallel Review Execution (multi-model-validation 4-Message Pattern + error-recovery)

  MESSAGE 1 (Prep - Bash only):
    - No Task calls, no TodoWrite
    - All preparation done in Phase 2

  MESSAGE 2 (Parallel - Task only):
    Task: senior-code-reviewer (embedded)
    ---
    Task: senior-code-reviewer PROXY_MODE: x-ai/grok-code-fast-1
    ---
    Task: senior-code-reviewer PROXY_MODE: google/gemini-2.5-flash
    ---
    Task: senior-code-reviewer PROXY_MODE: openai/gpt-5-codex

    All execute in parallel (3-5x speedup!)

    Error Recovery (handles during execution):
      - Grok times out after 30s → Skip, continue with 3 models
      - Gemini returns 500 error → Retry once, then skip if fails
      - GPT-5 succeeds
      - Embedded Claude succeeds
      Result: 2/4 external models succeeded

  MESSAGE 3 (Auto-Consolidate - Task only):
    Check results: 2 embedded + 2 external = 4 total (N ≥ 2 ✅)
    Automatically trigger consolidation

    Task: senior-code-reviewer (consolidation)
      Prompt: Read 4 review files, analyze consensus, prioritize

  MESSAGE 4 (Present):
    Show user:
    - Top 5 issues by consensus
    - Unanimous (100%) → MUST FIX
    - Strong (75%) → RECOMMENDED
    - Majority (50%) → CONSIDER
    - Note: "2/4 external models succeeded (Grok timeout, Gemini error)"
    - Link to detailed consolidated report

STEP 4: User Takes Action
  - Review detailed report
  - Fix prioritized issues
  - Re-run /review if needed
```

**Result:** Comprehensive multi-model review in ~5 minutes (vs 15+ sequential), gracefully handled 2 model failures

---

### Example 2: UI Validation with Feedback Loop

**User Request:** "/validate-ui" with Figma design

**Orchestrator:** `/validate-ui` command

**Skills Loaded:**
- `multi-agent-coordination` (parallel designer launch, agent selection)
- `quality-gates` (iteration loops, user validation, feedback handling)
- `todowrite-orchestration` (iteration tracking)
- `error-recovery` (user cancellation, external model failures)

**Workflow:**

```
STEP 1: Gather Inputs (multi-agent-coordination pattern)
  - Ask user: design reference, component description, use external AI?
  - Auto-detect reference type (Figma/URL/file)
  - Find implementation files (Glob/Grep)
  - Select agents: designer, ui-developer, optional ui-developer-codex

STEP 2: Automated Iteration Loop (quality-gates pattern + error-recovery)

  For iteration 1 to 10 or until PASS:

    STEP 2.1: Parallel Designer Validation (multi-agent-coordination + error-recovery)
      If external AI enabled:
        Launch TWO designers in parallel (single message):
          Task: designer (fetch design, compare, report issues)
          ---
          Task: designer PROXY_MODE: design-review (external validation)

        Error Recovery:
          - External model fails → Continue with embedded designer only
          - User presses Ctrl+C → Save partial results, exit gracefully

      Else:
        Launch ONE designer:
          Task: designer

    STEP 2.2: Consolidate Designer Feedback (quality-gates)
      If both ran:
        - Issues flagged by BOTH → CRITICAL
        - Issues flagged by ONE with severity CRITICAL → CRITICAL
        - Issues flagged by ONE with severity MEDIUM → MEDIUM
        - Create consolidated issue list
      Else:
        - Use single designer's report as-is

    STEP 2.3: Apply Fixes (multi-agent-coordination)
      Task: ui-developer
        Prompt: Fix all issues from consolidated report
        Priority: CRITICAL first, then MEDIUM, then LOW

    STEP 2.4: Check Loop Status (quality-gates)
      If designer says PASS:
        Exit loop → Go to User Validation
      Else if iteration < 10:
        Continue to next iteration
      Else:
        Max iterations reached → Go to User Validation

STEP 3: MANDATORY User Validation (quality-gates pattern)

  Present to user:
    "Automated validation complete after X iterations.
     Designer assessment: [PASS/NEEDS IMPROVEMENT]

     Please manually verify the implementation:
     - Open app at [URL]
     - Compare to design reference
     - Check colors, spacing, typography, etc.

     Does it match? (Yes/No)"

  If user says YES:
    ✅ Approved! → Generate final report

  If user says NO:
    Ask: "Describe the issues you found"

    User provides: "Button color wrong, spacing too tight"

    Launch: Task: ui-developer
      Prompt: Fix user-reported issues:
        - Button color: [specific issue]
        - Spacing: [specific issue]

    After fixes:
      Re-run designer validation
      Loop back to User Validation

    Continue until user approves (max 5 feedback rounds)

STEP 4: Generate Final Report
  - Iteration history (automated + user feedback rounds)
  - Screenshots (reference vs final implementation)
  - Side-by-side comparison HTML
  - User approval: ✅ "Looks perfect"
```

**Result:** Pixel-perfect UI validated by automation + human review, gracefully handled external model failure

---

### Example 3: Full-Cycle Implementation with Test-Driven Development

**User Request:** "/implement authentication feature"

**Orchestrator:** `/implement` command

**Skills Loaded:**
- `multi-agent-coordination` (task detection, sequential delegation)
- `quality-gates` (user approval gates, iteration loops, test-driven development)
- `todowrite-orchestration` (8-phase workflow tracking)
- `error-recovery` (test failures, model failures)
- `multi-model-validation` (optional for code review phase)

**Workflow:**

```
STEP 0: Initialize TodoWrite (todowrite-orchestration)
  Tasks: [Phase 1 plan, Phase 2 implement, Phase 2.5 test-driven, Phase 3 review, ...]

STEP 1: Architecture Planning (multi-agent-coordination)
  Task: api-architect
    Prompt: Design authentication system architecture
    Output: File-based (ai-docs/architecture-plan.md)
    Return: Brief summary only (avoid context pollution)

  Mark Phase 1 complete

STEP 2: Implementation (multi-agent-coordination)
  Task: backend-developer
    Prompt: Implement architecture from ai-docs/architecture-plan.md
    Sequential (depends on Phase 1)

  Mark Phase 2 complete

STEP 2.5: Test-Driven Feedback Loop (quality-gates + error-recovery)

  Task: test-architect
    Prompt: Write comprehensive tests for authentication

  Run tests: bun test

  Error Recovery Loop (max 10 iterations):
    If tests fail:
      1. Capture test output
      2. Launch: test-architect (analyze failure)
      3. Test-architect determines:
         - TEST_ISSUE: Test is wrong (bad assertion, missing mock)
         - IMPLEMENTATION_ISSUE: Code is wrong (bug, logic error)

      4. If TEST_ISSUE:
         - Test-architect fixes test
         - Re-run: bun test
         - Loop continues

      5. If IMPLEMENTATION_ISSUE:
         - Provide structured feedback to developer
         - Task: backend-developer (fix implementation based on test failure)
         - Re-run: bun test
         - Loop continues

      6. If tests pass: Exit loop → Proceed to code review

    Error Recovery:
      - Test execution fails (syntax error) → Fix syntax, retry
      - Test framework crashes → Notify user, skip TDD phase
      - User cancels (Ctrl+C) → Save partial results, exit

  Mark Phase 2.5 complete

STEP 3: Code Review (multi-model-validation + quality-gates + error-recovery)

  Option A: User requests multi-model review
    Follow 4-Message Pattern:
      - Parallel execution with Grok + Gemini + embedded
      - Handle model failures (timeout, API errors)
      - Auto-consolidation
      - Consensus analysis

  Option B: Single embedded review
    Task: senior-code-reviewer

  If CRITICAL issues found (quality-gates):
    Loop with developer to fix
    Re-run review

  Mark Phase 3 complete

STEP 4: User Acceptance (quality-gates)

  Present to user:
    "Implementation complete. Please review:
     - Files modified: [list]
     - Tests: [count] passing
     - Code review: [verdict]

     Accept? (Yes/No/Feedback)"

  If user says NO:
    Collect feedback
    Loop with developer
    Re-run tests and review

  Continue until user approves

  Mark Phase 4 complete

STEP 5: Cleanup (multi-agent-coordination)
  Task: project-cleaner
    Remove temporary files, format code

STEP 6: Present Results
  - Summary of all phases
  - Files modified
  - Tests added (all passing)
  - Code review verdict
  - User approval: ✅
```

**Result:** Complete feature from architecture to acceptance, test-driven development ensured quality, gracefully handled failures

---

## 8. Key Design Decisions

### Decision 1: 5 Skills (Added Error Recovery)

**Rationale:**
- Error recovery is **CRITICAL** for production workflows
- Moved from v1.2.0 future enhancement to v1.0.0 (now v0.1.0)
- Real-world multi-model validation fails ~30% of time (timeout, API errors)
- Test-driven development needs error recovery patterns

**Trade-off:**
- More skills to maintain (5 vs 4)

**Mitigation:**
- Error recovery skill is highly focused
- Complements multi-model-validation perfectly
- Essential for resilience

---

### Decision 2: Version 0.1.0 (Not 1.0.0)

**Rationale:**
- Conservative approach for initial release
- Allows for breaking changes during 0.x phase if needed
- Graduate to 1.0.0 after real-world validation (2-3 months)
- Semantic versioning best practice: 0.x = experimental, 1.x = stable

**Trade-off:**
- Signal of instability to users

**Mitigation:**
- Clear communication: "Initial release, maturing to 1.0.0"
- Define go/no-go gates for 1.0.0 graduation
- Provide migration path from 0.x to 1.x

---

### Decision 3: Skill Bundles

**Rationale:**
- Simplifies skill loading for common scenarios
- Reduces version coupling (plugins reference bundles, not individual skills)
- Provides preset combinations: core, advanced, testing, complete

**Trade-off:**
- More complexity in plugin.json

**Mitigation:**
- Clear documentation of bundle contents
- Bundles are optional (can still load individual skills)

---

### Decision 4: Skill Requirements in Frontmatter

**Rationale:**
- Explicit dependency contract between commands and skills
- Graceful degradation when optional skills missing
- Version compatibility checking

**Trade-off:**
- More frontmatter boilerplate

**Mitigation:**
- Only use when necessary (most commands don't need this)
- Clear syntax: `skills_required`, `skills_optional`

---

### Decision 5: User-Centric Skill Descriptions

**Rationale:**
- AI models need trigger keywords to auto-load skills
- Users search for "grok review" not "multi-model validation"
- Descriptions must be discoverable and actionable

**Trade-off:**
- Longer descriptions

**Mitigation:**
- Max 1024 characters (Claude Code frontmatter limit)
- Prioritize keywords over technical jargon
- Use "Trigger keywords" suffix for clarity

---

### Decision 6: Skills-Only Plugin (No Agents/Commands)

**Rationale:**
- Orchestration is **knowledge**, not **functionality**
- Agents/commands live in domain plugins (frontend, backend)
- Skills provide **reusable patterns** across all plugins
- Keeps orchestration plugin lightweight and focused

**Trade-off:**
- Can't demonstrate patterns with example commands

**Mitigation:**
- Provide detailed examples in each skill
- Reference existing commands (e.g., `/review` uses multi-model-validation)

---

### Decision 7: Keep Critical Content Inline in Commands

**Rationale:**
- **Visibility** - Orchestrators must see "no Write/Edit" constraints
- **Self-contained** - Commands work without skill loading
- **Backward compatible** - Existing commands unchanged
- **Fail-safe** - If skill load fails, command still has core instructions

**Trade-off:**
- Some content duplication (inline + skill)

**Mitigation:**
- Skills provide **additional context** and **best practices**
- Commands provide **specific workflow** and **constraints**
- Balance: Critical inline, patterns in skills

---

## 9. Success Criteria

### Plugin Creation Success (v0.1.0)

✅ **Orchestration plugin installable**
- Valid plugin.json manifest
- 5 skills with complete content
- Examples and documentation
- Published to marketplace

✅ **Skills are context-efficient**
- Each skill < 1500 lines (realistic for complex patterns)
- No duplicate content across skills
- Clear, actionable guidance

✅ **Integration works**
- Frontend plugin depends on orchestration
- Skills load successfully in commands
- No breaking changes to existing workflows

✅ **Error recovery validated**
- Timeout handling tested
- API failure scenarios tested
- Partial success handling tested
- User cancellation handling tested

### Adoption Success (3 months → v1.0.0 graduation)

✅ **Plugin adoption**
- Frontend, bun, code-analysis plugins depend on orchestration
- 100+ installations via dependencies
- Positive user feedback
- 0 CRITICAL bugs reported

✅ **Skill usage**
- Agents reference skills in prompts
- Custom user agents leverage patterns
- Reduced command prompt sizes (patterns moved to skills)

✅ **Pattern validation**
- Multi-model validation used in production
- 4-Message Pattern achieves 3-5x speedup
- Quality gates prevent issues from reaching users
- Error recovery handles failures gracefully

✅ **Graduate to v1.0.0**
- All go/no-go gates passed
- Migration guide from 0.x to 1.x provided
- Breaking changes documented (if any)

---

## 10. Future Enhancements (Post v1.0)

### v1.1.0: Workflow Templates Skill

**New Skill:** `workflow-templates`

**Purpose:** Pre-built workflow templates for common scenarios

**Content:**
- Template: Multi-phase implementation (plan → code → test → review → accept)
- Template: Parallel validation (designer + tester + reviewer)
- Template: Cost-optimized review (free models only)
- Template: Iterative refinement (loop until quality threshold met)

### v1.2.0: Performance Optimization

**Enhancement to existing skills:**
- **multi-agent-coordination:** Add caching patterns for repeated agent calls
- **multi-model-validation:** Add model selection by cost/speed trade-off
- **todowrite-orchestration:** Add progress estimation (time remaining)

### v1.3.0: Context Window Management

**New Skill:** `context-optimization`

**Purpose:** Advanced context window management strategies

**Content:**
- Context budget allocation across phases
- Dynamic skill loading/unloading
- Context size estimation and monitoring
- Tool restriction enforcement patterns

### v2.0.0: Auto-Loading by Keywords

**Breaking Change:** Skills auto-load based on command keywords

**Trigger Examples:**
- Command contains "parallel" → Load `multi-agent-coordination`
- Command contains "models" → Load `multi-model-validation`
- Command has >3 phases → Load `todowrite-orchestration`
- Command has "approval" → Load `quality-gates`

**Benefit:** Less explicit skill loading required
**Trade-off:** Less control, potential for over-loading

---

## 11. Appendices

### Appendix A: Skill File Structure

Each skill follows this structure:

```markdown
---
name: skill-name-kebab-case
description: User-centric description with trigger keywords, max 1024 chars. Trigger keywords - "keyword1", "keyword2", "keyword3".
version: 1.0.0
tags: [orchestration, tag1, tag2, tag3]
keywords: [keyword1, keyword2, keyword3, keyword4]
---

# Skill Name

**Version:** 1.0.0
**Purpose:** One-sentence purpose
**Status:** Production Ready

## Overview

High-level introduction (2-3 paragraphs)

## Core Patterns

### Pattern 1: Pattern Name

**When to Use:** Specific scenarios

**How It Works:** Step-by-step guide

**Example:** Concrete code/workflow example

**Anti-Patterns:** What NOT to do

### Pattern 2: ...

## Integration

How this skill works with other skills

## Best Practices

Dos and don'ts

## Examples

2-4 complete workflow examples

## Troubleshooting

Common issues and solutions
```

### Appendix B: Dependency Graph

```
User Project
  └─ Frontend Plugin (v3.7.0+)
      └─ Orchestration Plugin (v0.1.0 → v1.0.0)
          ├─ multi-agent-coordination skill
          ├─ multi-model-validation skill
          ├─ quality-gates skill
          ├─ todowrite-orchestration skill
          └─ error-recovery skill

  └─ Bun Backend Plugin (v1.3.0+)
      └─ Orchestration Plugin (v0.1.0 → v1.0.0)
          └─ [same 5 skills]

  └─ Code Analysis Plugin (v1.2.0+)
      └─ Orchestration Plugin (v0.1.0 → v1.0.0)
          └─ [same 5 skills]

  └─ Custom User Plugin
      └─ Orchestration Plugin (v0.1.0+) [optional]
```

### Appendix C: Migration Checklist for Plugin Authors

**Adding Orchestration Dependency to Your Plugin:**

- [ ] Add orchestration to `plugin.json` dependencies:
  ```json
  "dependencies": {
    "orchestration@magus": "^0.1.0"
  }
  ```

- [ ] Update plugin version (minor bump: v1.2.0 → v1.3.0)

- [ ] (Optional) Add skill references to agent/command prompts:
  ```yaml
  skills: orchestration:multi-model-validation, orchestration:quality-gates
  ```

- [ ] (Optional) Remove duplicate orchestration content from prompts
  - Keep critical constraints inline
  - Move reusable patterns to skill references

- [ ] Test plugin installation with dependency

- [ ] Test skill loading in agents/commands

- [ ] Update plugin README to mention orchestration dependency

- [ ] Release new plugin version

---

## Summary

**Plugin Name:** orchestration
**Version:** 0.1.0 (graduating to 1.0.0 after 2-3 months)
**Skills:** 5 (multi-agent-coordination, multi-model-validation, quality-gates, todowrite-orchestration, error-recovery)

**Key Design Decisions:**
1. **5 skills** - Added error-recovery from future enhancements (CRITICAL for production)
2. **Version 0.1.0** - Conservative initial release, mature to 1.0.0 after validation
3. **User-centric descriptions** - Trigger keywords (grok, gemini, claudish, parallel, consensus)
4. **Skill loading mechanics defined** - Explicit syntax, error handling, graceful degradation
5. **Skill bundles** - Predefined combinations (core, advanced, testing, complete)
6. **Skill requirements** - skills_required/skills_optional for graceful degradation
7. **Version coupling mitigation** - Flexible versioning, bundles, deprecation policy
8. **Test-driven development loop** - Extracted from /implement PHASE 2.5 to quality-gates skill
9. **Comprehensive error recovery** - 7 scenarios (timeout, API failure, partial success, cancellation, missing tools, no credits, retry strategies)

**Integration Approach:**
- Frontend plugin (v3.7.0+) depends on orchestration
- Other plugins (bun, code-analysis) can add dependency
- Custom user agents can cherry-pick skills
- Skills provide patterns, commands provide workflows

**Migration Strategy:**
- Phase 1: Create orchestration plugin (v0.1.0) - Week 1
- Phase 2: Add dependency to frontend (v3.7.0) - Week 2
- Phase 3: Gradual skill references (v3.8.0+) - Weeks 3-4
- Phase 4: Extend to other plugins - Weeks 5-8
- Phase 5: Graduate to v1.0.0 - Month 3 (with go/no-go gates)

**File Location:** `ai-docs/plugin-design-orchestration-v2.md`

**Next Steps:**
1. Review this revised design document
2. Address any remaining feedback
3. Create orchestration plugin structure
4. Write 5 skills with extracted content
5. Add dependency to frontend plugin
6. Test integration and skill loading
7. Release orchestration v0.1.0 + frontend v3.7.0

---

**Maintained by:** MadAppGang
**Design Date:** November 22, 2025
**Design Version:** 2.0 (Revised)
**Status:** Ready for Implementation
**Changes:** Addressed 5 CRITICAL/HIGH issues from multi-model review feedback
