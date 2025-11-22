---
name: multi-model-validation
description: Run multiple AI models in parallel for 3-5x speedup. Use when validating with Grok, Gemini, GPT-5, DeepSeek, or Claudish proxy for code review, consensus analysis, or multi-expert validation. Trigger keywords - "grok", "gemini", "gpt-5", "deepseek", "claudish", "multiple models", "parallel review", "external AI", "consensus", "multi-model".
version: 0.1.0
tags: [orchestration, claudish, parallel, consensus, multi-model, grok, gemini, external-ai]
keywords: [grok, gemini, gpt-5, deepseek, claudish, parallel, consensus, multi-model, external-ai, proxy, openrouter]
---

# Multi-Model Validation

**Version:** 1.0.0
**Purpose:** Patterns for running multiple AI models in parallel via Claudish proxy
**Status:** Production Ready

## Overview

Multi-model validation is the practice of running multiple AI models (Grok, Gemini, GPT-5, DeepSeek, etc.) in parallel to validate code, designs, or implementations from different perspectives. This achieves:

- **3-5x speedup** via parallel execution (15 minutes → 5 minutes)
- **Consensus-based prioritization** (issues flagged by all models are CRITICAL)
- **Diverse perspectives** (different models catch different issues)
- **Cost transparency** (know before you spend)

The key innovation is the **4-Message Pattern**, which ensures true parallel execution by using only Task tool calls in a single message, avoiding the sequential execution trap caused by mixing tool types.

This skill is extracted from the `/review` command and generalized for use in any multi-model workflow.

## Core Patterns

### Pattern 1: The 4-Message Pattern (MANDATORY)

This pattern is **CRITICAL** for achieving true parallel execution with multiple AI models.

**Why This Pattern Exists:**

Claude Code executes tools **sequentially by default** when different tool types are mixed in the same message. To achieve true parallelism, you MUST:
1. Use ONLY one tool type per message
2. Ensure all Task calls are in a single message
3. Separate preparation (Bash) from execution (Task) from presentation

**The Pattern:**

```
Message 1: Preparation (Bash Only)
  - Create workspace directories
  - Validate inputs (check if claudish installed)
  - Write context files (code to review, design reference, etc.)
  - NO Task calls
  - NO TodoWrite calls

Message 2: Parallel Execution (Task Only)
  - Launch ALL AI models in SINGLE message
  - ONLY Task tool calls
  - Separate each Task with --- delimiter
  - Each Task is independent (no dependencies)
  - All execute simultaneously

Message 3: Auto-Consolidation (Task Only)
  - Automatically triggered when N ≥ 2 models complete
  - Launch consolidation agent
  - Pass all review file paths
  - Apply consensus analysis

Message 4: Present Results
  - Show user prioritized issues
  - Include consensus levels (unanimous, strong, majority)
  - Link to detailed reports
  - Cost summary (if applicable)
```

**Example: 5-Model Parallel Code Review**

```
Message 1: Preparation
  Bash: mkdir -p ai-docs/reviews
  Bash: git diff > ai-docs/code-review-context.md
  Bash: which claudish (check if installed)

Message 2: Parallel Execution
  Task: senior-code-reviewer
    Prompt: "Review ai-docs/code-review-context.md for security issues.
             Write detailed review to ai-docs/reviews/claude-review.md
             Return only brief summary."
  ---
  Task: codex-code-reviewer PROXY_MODE: x-ai/grok-code-fast-1
    Prompt: "Review ai-docs/code-review-context.md for security issues.
             Write detailed review to ai-docs/reviews/grok-review.md
             Return only brief summary."
  ---
  Task: codex-code-reviewer PROXY_MODE: google/gemini-2.5-flash
    Prompt: "Review ai-docs/code-review-context.md for security issues.
             Write detailed review to ai-docs/reviews/gemini-review.md
             Return only brief summary."
  ---
  Task: codex-code-reviewer PROXY_MODE: openai/gpt-5-codex
    Prompt: "Review ai-docs/code-review-context.md for security issues.
             Write detailed review to ai-docs/reviews/gpt5-review.md
             Return only brief summary."
  ---
  Task: codex-code-reviewer PROXY_MODE: deepseek/deepseek-coder
    Prompt: "Review ai-docs/code-review-context.md for security issues.
             Write detailed review to ai-docs/reviews/deepseek-review.md
             Return only brief summary."

  All 5 models execute simultaneously (5x parallelism!)

Message 3: Auto-Consolidation
  (Automatically triggered - don't wait for user to request)

  Task: senior-code-reviewer
    Prompt: "Consolidate 5 code reviews from:
             - ai-docs/reviews/claude-review.md
             - ai-docs/reviews/grok-review.md
             - ai-docs/reviews/gemini-review.md
             - ai-docs/reviews/gpt5-review.md
             - ai-docs/reviews/deepseek-review.md

             Apply consensus analysis:
             - Issues flagged by ALL 5 → UNANIMOUS (VERY HIGH confidence)
             - Issues flagged by 4 → STRONG (HIGH confidence)
             - Issues flagged by 3 → MAJORITY (MEDIUM confidence)
             - Issues flagged by 1-2 → DIVERGENT (LOW confidence)

             Prioritize by consensus level and severity.
             Write to ai-docs/consolidated-review.md"

Message 4: Present Results
  "Multi-model code review complete! 5 AI models analyzed your code.

   Top 5 Issues (Prioritized by Consensus):
   1. [UNANIMOUS] Missing input validation on POST /api/users
   2. [UNANIMOUS] SQL injection risk in search endpoint
   3. [STRONG] Weak password hashing (bcrypt rounds too low)
   4. [MAJORITY] Missing rate limiting on authentication endpoints
   5. [MAJORITY] Insufficient error handling in payment flow

   See ai-docs/consolidated-review.md for complete analysis."
```

**Performance Impact:**

- Sequential execution: 5 models × 3 min = 15 minutes
- Parallel execution: max(model times) ≈ 5 minutes
- **Speedup: 3x with perfect parallelism**

---

### Pattern 2: Parallel Execution Architecture

**Single Message, Multiple Tasks:**

The key to parallel execution is putting ALL Task calls in a **single message** with the `---` delimiter:

```
✅ CORRECT - Parallel Execution:

Task: agent1
  Prompt: "Task 1 instructions"
---
Task: agent2
  Prompt: "Task 2 instructions"
---
Task: agent3
  Prompt: "Task 3 instructions"

All 3 execute simultaneously.
```

**Anti-Pattern: Sequential Execution**

```
❌ WRONG - Sequential Execution:

Message 1:
  Task: agent1

Message 2:
  Task: agent2

Message 3:
  Task: agent3

Each task waits for previous to complete (3x slower).
```

**Independent Tasks Requirement:**

Each Task must be **independent** (no dependencies):

```
✅ CORRECT - Independent:
  Task: review code for security
  Task: review code for performance
  Task: review code for style

  All can run simultaneously (same input, different perspectives).

❌ WRONG - Dependent:
  Task: implement feature
  Task: write tests for feature (depends on implementation)
  Task: review implementation (depends on tests)

  Must run sequentially (each needs previous output).
```

**Unique Output Files:**

Each Task MUST write to a **unique output file** to avoid conflicts:

```
✅ CORRECT - Unique Files:
  Task: reviewer1 → ai-docs/reviews/claude-review.md
  Task: reviewer2 → ai-docs/reviews/grok-review.md
  Task: reviewer3 → ai-docs/reviews/gemini-review.md

❌ WRONG - Shared File:
  Task: reviewer1 → ai-docs/review.md
  Task: reviewer2 → ai-docs/review.md (overwrites reviewer1!)
  Task: reviewer3 → ai-docs/review.md (overwrites reviewer2!)
```

**Wait for All Before Consolidation:**

Do NOT consolidate until ALL tasks complete:

```
✅ CORRECT - Wait for All:
  Launch: Task1, Task2, Task3, Task4 (parallel)
  Wait: All 4 complete
  Check: results.filter(r => r.status === 'fulfilled').length
  If >= 2: Proceed with consolidation
  If < 2: Offer retry or abort

❌ WRONG - Premature Consolidation:
  Launch: Task1, Task2, Task3, Task4
  After 30s: Task1, Task2 done
  Consolidate: Only Task1 + Task2 (Task3, Task4 still running!)
```

---

### Pattern 3: Proxy Mode Implementation

**PROXY_MODE Directive:**

External AI models are invoked via the PROXY_MODE directive in agent prompts:

```
Task: codex-code-reviewer PROXY_MODE: x-ai/grok-code-fast-1
  Prompt: "Review code for security issues..."
```

**Agent Behavior:**

When an agent sees PROXY_MODE, it:

```
1. Detects PROXY_MODE directive in incoming prompt
2. Extracts model name (e.g., "x-ai/grok-code-fast-1")
3. Extracts actual task (everything after PROXY_MODE line)
4. Constructs claudish command:
   printf '%s' "AGENT_PROMPT" | claudish --model x-ai/grok-code-fast-1 --stdin --quiet --auto-approve
5. Executes SYNCHRONOUSLY (blocking, waits for full response)
6. Captures full output
7. Writes detailed results to file (ai-docs/grok-review.md)
8. Returns BRIEF summary only (2-5 sentences)
```

**Critical: Blocking Execution**

External model calls MUST be **synchronous (blocking)** so the agent waits for completion:

```
✅ CORRECT - Blocking (Synchronous):
  RESULT=$(printf '%s' "$PROMPT" | claudish --model grok --stdin --quiet --auto-approve)
  echo "$RESULT" > ai-docs/grok-review.md
  echo "Grok review complete. See ai-docs/grok-review.md"

❌ WRONG - Background (Asynchronous):
  printf '%s' "$PROMPT" | claudish --model grok --stdin --quiet --auto-approve &
  echo "Grok review started..."  # Agent returns immediately, review not done!
```

**Why Blocking Matters:**

If agents return before external models complete, the orchestrator will:
- Think all reviews are done (they're not)
- Try to consolidate partial results (missing data)
- Present incomplete results to user (bad experience)

**Output Strategy:**

Agents write **full detailed output to file** and return **brief summary only**:

```
Full Output (ai-docs/grok-review.md):
  "# Code Review by Grok

   ## Security Issues

   ### CRITICAL: SQL Injection in User Search
   The search endpoint constructs SQL queries using string concatenation...
   [500 more lines of detailed analysis]"

Brief Summary (returned to orchestrator):
  "Grok review complete. Found 3 CRITICAL, 5 HIGH, 12 MEDIUM issues.
   See ai-docs/grok-review.md for details."
```

**Why Brief Summaries:**

- Orchestrator doesn't need full 500-line review in context
- Full review is in file for consolidation agent
- Keeps orchestrator context clean (context efficiency)

**Auto-Approve Flag:**

Use `--auto-approve` flag to prevent interactive prompts:

```
✅ CORRECT - Auto-Approve:
  claudish --model grok --stdin --quiet --auto-approve

❌ WRONG - Interactive (blocks waiting for user input):
  claudish --model grok --stdin --quiet
  # Waits for user to approve costs... but this is inside an agent!
```

---

### Pattern 4: Cost Estimation and Transparency

**Input/Output Token Separation:**

Provide separate estimates for input and output tokens:

```
Cost Estimation for Multi-Model Review:

Input Tokens (per model):
  - Code context: 500 lines × 1.5 = 750 tokens
  - Review instructions: 200 tokens
  - Total input per model: ~1000 tokens
  - Total input (5 models): 5,000 tokens

Output Tokens (per model):
  - Expected output: 2,000 - 4,000 tokens
  - Total output (5 models): 10,000 - 20,000 tokens

Cost Calculation (example rates):
  - Input: 5,000 tokens × $0.0001/1k = $0.0005
  - Output: 15,000 tokens × $0.0005/1k = $0.0075 (3-5x more expensive)
  - Total: $0.0080 (range: $0.0055 - $0.0105)

User Approval Gate:
  "Multi-model review will cost approximately $0.008 ($0.005 - $0.010).
   Proceed? (Yes/No)"
```

**Input Token Estimation Formula:**

```
Input Tokens = (Code Lines × 1.5) + Instruction Tokens

Why 1.5x multiplier?
  - Code lines: ~1 token per line (average)
  - Context overhead: +50% (imports, comments, whitespace)

Example:
  500 lines of code → 500 × 1.5 = 750 tokens
  + 200 instruction tokens = 950 tokens total input
```

**Output Token Estimation Formula:**

```
Output Tokens = Base Estimate + Complexity Factor

Base Estimates by Task Type:
  - Code review: 2,000 - 4,000 tokens
  - Design validation: 1,000 - 2,000 tokens
  - Architecture planning: 3,000 - 6,000 tokens
  - Bug investigation: 2,000 - 5,000 tokens

Complexity Factors:
  - Simple (< 100 lines code): Use low end of range
  - Medium (100-500 lines): Use mid-range
  - Complex (> 500 lines): Use high end of range

Example:
  400 lines of complex code → 4,000 tokens (high complexity)
  50 lines of simple code → 2,000 tokens (low complexity)
```

**Range-Based Estimates:**

Always provide a **range** (min-max), not a single number:

```
✅ CORRECT - Range:
  "Estimated cost: $0.005 - $0.010 (depends on review depth)"

❌ WRONG - Single Number:
  "Estimated cost: $0.0075"
  (User surprised when actual is $0.0095)
```

**Why Output Costs More:**

Output tokens are typically **3-5x more expensive** than input tokens:

```
Example Pricing (OpenRouter):
  - Grok: $0.50 / 1M input, $1.50 / 1M output (3x difference)
  - Gemini Flash: $0.10 / 1M input, $0.40 / 1M output (4x difference)
  - GPT-5 Codex: $1.00 / 1M input, $5.00 / 1M output (5x difference)

Impact:
  If input = 5,000 tokens, output = 15,000 tokens:
    Input cost: $0.0005
    Output cost: $0.0075 (15x higher despite only 3x more tokens)
    Total: $0.0080 (94% is output!)
```

**User Approval Before Execution:**

ALWAYS ask for user approval before expensive operations:

```
Present to user:
  "You selected 5 AI models for code review:
   - Claude Sonnet (embedded, free)
   - Grok Code Fast (external, $0.002)
   - Gemini 2.5 Flash (external, $0.001)
   - GPT-5 Codex (external, $0.004)
   - DeepSeek Coder (external, $0.001)

   Estimated total cost: $0.008 ($0.005 - $0.010)

   Proceed with multi-model review? (Yes/No)"

If user says NO:
  Offer alternatives:
    1. Use only free embedded Claude
    2. Select fewer models
    3. Cancel review

If user says YES:
  Proceed with Message 2 (parallel execution)
```

---

### Pattern 5: Auto-Consolidation Logic

**Automatic Trigger:**

Consolidation should happen **automatically** when N ≥ 2 reviews complete:

```
✅ CORRECT - Auto-Trigger:

const results = await Promise.allSettled([task1, task2, task3, task4, task5]);
const successful = results.filter(r => r.status === 'fulfilled');

if (successful.length >= 2) {
  // Auto-trigger consolidation (DON'T wait for user to ask)
  const consolidated = await Task({
    subagent_type: "senior-code-reviewer",
    description: "Consolidate reviews",
    prompt: `Consolidate ${successful.length} reviews and apply consensus analysis`
  });

  return formatResults(consolidated);
} else {
  // Too few successful reviews
  notifyUser("Only 1 model succeeded. Retry failures or abort?");
}

❌ WRONG - Wait for User:

const results = await Promise.allSettled([...]);
const successful = results.filter(r => r.status === 'fulfilled');

// Present results to user
notifyUser("3 reviews complete. Would you like me to consolidate them?");
// Waits for user to request consolidation...
```

**Why Auto-Trigger:**

- Better UX (no extra user prompt needed)
- Faster workflow (no wait for user response)
- Expected behavior (user assumes consolidation is part of workflow)

**Minimum Threshold:**

Require **at least 2 successful reviews** for meaningful consensus:

```
if (successful.length >= 2) {
  // Proceed with consolidation
} else if (successful.length === 1) {
  // Only 1 review succeeded
  notifyUser("Only 1 model succeeded. No consensus available. See single review or retry?");
} else {
  // All failed
  notifyUser("All models failed. Check logs and retry?");
}
```

**Pass All Review File Paths:**

Consolidation agent needs paths to ALL review files:

```
Task: senior-code-reviewer
  Prompt: "Consolidate reviews from these files:
           - ai-docs/reviews/claude-review.md
           - ai-docs/reviews/grok-review.md
           - ai-docs/reviews/gemini-review.md

           Apply consensus analysis and prioritize issues."
```

**Don't Inline Full Reviews:**

```
❌ WRONG - Inline Reviews (context pollution):
  Prompt: "Consolidate these reviews:

           Claude Review:
           [500 lines of review content]

           Grok Review:
           [500 lines of review content]

           Gemini Review:
           [500 lines of review content]"

✅ CORRECT - File Paths:
  Prompt: "Read and consolidate reviews from:
           - ai-docs/reviews/claude-review.md
           - ai-docs/reviews/grok-review.md
           - ai-docs/reviews/gemini-review.md"
```

---

### Pattern 6: Consensus Analysis

**Consensus Levels:**

Classify issues by how many models flagged them:

```
Consensus Levels (for N models):

UNANIMOUS (100% agreement):
  - All N models flagged this issue
  - VERY HIGH confidence
  - MUST FIX priority

STRONG CONSENSUS (67-99% agreement):
  - Most models flagged this issue (⌈2N/3⌉ to N-1)
  - HIGH confidence
  - RECOMMENDED priority

MAJORITY (50-66% agreement):
  - Half or more models flagged this issue (⌈N/2⌉ to ⌈2N/3⌉-1)
  - MEDIUM confidence
  - CONSIDER priority

DIVERGENT (< 50% agreement):
  - Only 1-2 models flagged this issue
  - LOW confidence
  - OPTIONAL priority (may be model-specific perspective)
```

**Example: 5 Models**

```
Issue Flagged By:              Consensus Level:    Priority:
─────────────────────────────────────────────────────────────
All 5 models                   UNANIMOUS (100%)    MUST FIX
4 models                       STRONG (80%)        RECOMMENDED
3 models                       MAJORITY (60%)      CONSIDER
2 models                       DIVERGENT (40%)     OPTIONAL
1 model                        DIVERGENT (20%)     OPTIONAL
```

**Keyword-Based Matching (v1.0):**

Simple consensus analysis using keyword matching:

```
Algorithm:

1. Extract issues from each review
2. For each unique issue:
   a. Identify keywords (e.g., "SQL injection", "input validation")
   b. Check which other reviews mention same keywords
   c. Count models that flagged this issue
   d. Assign consensus level

Example:

Claude Review: "Missing input validation on POST /api/users"
Grok Review: "Input validation absent in user creation endpoint"
Gemini Review: "No validation for user POST endpoint"

Keywords: ["input validation", "POST", "/api/users", "user"]
Match: All 3 reviews mention these keywords
Consensus: UNANIMOUS (3/3 = 100%)
```

**Model Agreement Matrix:**

Show which models agree on which issues:

```
Issue Matrix:

Issue                             Claude  Grok  Gemini  GPT-5  DeepSeek  Consensus
──────────────────────────────────────────────────────────────────────────────────
SQL injection in search              ✓      ✓     ✓       ✓       ✓      UNANIMOUS
Missing input validation             ✓      ✓     ✓       ✓       ✗      STRONG
Weak password hashing                ✓      ✓     ✓       ✗       ✗      MAJORITY
Missing rate limiting                ✓      ✓     ✗       ✗       ✗      DIVERGENT
Insufficient error handling          ✓      ✗     ✗       ✗       ✗      DIVERGENT
```

**Prioritized Issue List:**

Sort issues by consensus level, then by severity:

```
Top 10 Issues (Prioritized):

1. [UNANIMOUS - CRITICAL] SQL injection in search endpoint
   Flagged by: Claude, Grok, Gemini, GPT-5, DeepSeek (5/5)

2. [UNANIMOUS - HIGH] Missing input validation on POST /api/users
   Flagged by: Claude, Grok, Gemini, GPT-5, DeepSeek (5/5)

3. [STRONG - HIGH] Weak password hashing (bcrypt rounds too low)
   Flagged by: Claude, Grok, Gemini, GPT-5 (4/5)

4. [STRONG - MEDIUM] Missing rate limiting on auth endpoints
   Flagged by: Claude, Grok, Gemini, GPT-5 (4/5)

5. [MAJORITY - MEDIUM] Insufficient error handling in payment flow
   Flagged by: Claude, Grok, Gemini (3/5)

... (remaining issues)
```

**Future Enhancement (v1.1+): Semantic Similarity**

```
Instead of keyword matching, use semantic similarity:
  - Embed issue descriptions with sentence-transformers
  - Calculate cosine similarity between embeddings
  - Issues with >0.8 similarity are "same issue"
  - More accurate consensus detection
```

---

## Integration with Other Skills

**multi-model-validation + quality-gates:**

```
Use Case: Cost approval before expensive multi-model review

Step 1: Cost Estimation (multi-model-validation)
  Calculate input/output tokens
  Estimate cost range

Step 2: User Approval Gate (quality-gates)
  Present cost estimate
  Ask user for approval
  If NO: Offer alternatives or abort
  If YES: Proceed with execution

Step 3: Parallel Execution (multi-model-validation)
  Follow 4-Message Pattern
  Launch all models simultaneously
```

**multi-model-validation + error-recovery:**

```
Use Case: Handling external model failures gracefully

Step 1: Parallel Execution (multi-model-validation)
  Launch 5 external models

Step 2: Error Handling (error-recovery)
  Model 1: Success
  Model 2: Timeout after 30s → Skip, continue with others
  Model 3: API 500 error → Retry once, then skip
  Model 4: Success
  Model 5: Success

Step 3: Partial Success Strategy (error-recovery)
  3/5 models succeeded (≥ 2 threshold)
  Proceed with consolidation using 3 reviews
  Notify user: "2 models failed, proceeding with 3 reviews"

Step 4: Consolidation (multi-model-validation)
  Consolidate 3 successful reviews
  Apply consensus analysis
```

**multi-model-validation + todowrite-orchestration:**

```
Use Case: Real-time progress tracking during parallel execution

Step 1: Initialize TodoWrite (todowrite-orchestration)
  Tasks:
    1. Prepare workspace
    2. Launch Claude review
    3. Launch Grok review
    4. Launch Gemini review
    5. Launch GPT-5 review
    6. Consolidate reviews
    7. Present results

Step 2: Update Progress (todowrite-orchestration)
  Mark tasks complete as models finish:
    - Claude completes → Mark task 2 complete
    - Grok completes → Mark task 3 complete
    - Gemini completes → Mark task 4 complete
    - GPT-5 completes → Mark task 5 complete

Step 3: User Sees Real-Time Progress
  "3/4 external models completed, 1 in progress..."
```

---

## Best Practices

**Do:**
- ✅ Use 4-Message Pattern for true parallel execution
- ✅ Provide cost estimates BEFORE execution
- ✅ Ask user approval for costs >$0.01
- ✅ Auto-trigger consolidation when N ≥ 2 reviews complete
- ✅ Use blocking (synchronous) claudish execution
- ✅ Write full output to files, return brief summaries
- ✅ Prioritize by consensus level (unanimous → strong → majority → divergent)
- ✅ Show model agreement matrix
- ✅ Handle partial success gracefully (some models fail)

**Don't:**
- ❌ Mix tool types in Message 2 (breaks parallelism)
- ❌ Use background claudish execution (returns before completion)
- ❌ Wait for user to request consolidation (auto-trigger instead)
- ❌ Consolidate with < 2 successful reviews (no meaningful consensus)
- ❌ Inline full reviews in consolidation prompt (use file paths)
- ❌ Return full 500-line reviews to orchestrator (use brief summaries)
- ❌ Skip cost approval gate for expensive operations

**Performance:**
- Parallel execution: 3-5x faster than sequential
- Message 2 speedup: 15 min → 5 min with 5 models
- Context efficiency: Brief summaries save 50-80% context

---

## Examples

### Example 1: 3-Model Code Review with Cost Approval

**Scenario:** User requests "Review my changes with Grok and Gemini"

**Execution:**

```
Message 1: Preparation
  Bash: mkdir -p ai-docs/reviews
  Bash: git diff > ai-docs/code-review-context.md
  Bash: wc -l ai-docs/code-review-context.md
  Output: 450 lines

  Calculate costs:
    Input: 450 × 1.5 = 675 tokens per model
    Output: 2000-4000 tokens per model
    Total: 3 models × (675 input + 3000 output avg) = 11,025 tokens
    Cost: ~$0.006 ($0.004 - $0.008)

Message 2: User Approval Gate (quality-gates skill)
  Present to user:
    "Multi-model review will analyze 450 lines of code with 3 AI models:
     - Claude Sonnet (embedded, free)
     - Grok Code Fast ($0.002)
     - Gemini 2.5 Flash ($0.001)

     Estimated cost: $0.006 ($0.004 - $0.008)

     Proceed? (Yes/No)"

  User: "Yes"

Message 3: Parallel Execution (Task only)
  Task: senior-code-reviewer
    Prompt: "Review ai-docs/code-review-context.md.
             Write to ai-docs/reviews/claude-review.md
             Return brief summary."
  ---
  Task: codex-code-reviewer PROXY_MODE: x-ai/grok-code-fast-1
    Prompt: "Review ai-docs/code-review-context.md.
             Write to ai-docs/reviews/grok-review.md
             Return brief summary."
  ---
  Task: codex-code-reviewer PROXY_MODE: google/gemini-2.5-flash
    Prompt: "Review ai-docs/code-review-context.md.
             Write to ai-docs/reviews/gemini-review.md
             Return brief summary."

  All 3 execute simultaneously (3x speedup)

Message 4: Auto-Consolidation (automatic)
  results.length = 3 (all succeeded)
  3 ≥ 2 ✓ (threshold met)

  Task: senior-code-reviewer
    Prompt: "Consolidate 3 reviews from:
             - ai-docs/reviews/claude-review.md
             - ai-docs/reviews/grok-review.md
             - ai-docs/reviews/gemini-review.md

             Apply consensus analysis."
    Output: ai-docs/consolidated-review.md

Message 5: Present Results
  "Multi-model review complete! 3 AI models analyzed 450 lines.

   Top 5 Issues (Consensus):
   1. [UNANIMOUS] SQL injection in search endpoint
   2. [UNANIMOUS] Missing input validation on user creation
   3. [STRONG] Weak password hashing (2/3 models)
   4. [MAJORITY] Missing rate limiting (2/3 models)
   5. [DIVERGENT] Code style inconsistency (1/3 model)

   Actual cost: $0.0058 (within estimate)
   See ai-docs/consolidated-review.md for details."
```

**Result:** 5 minutes total, consensus-based prioritization, cost transparency

---

### Example 2: Partial Success with Error Recovery

**Scenario:** 4 models selected, 2 fail

**Execution:**

```
Message 1: Preparation
  (same as Example 1)

Message 2: Parallel Execution
  Task: senior-code-reviewer (embedded)
  Task: PROXY_MODE grok (external)
  Task: PROXY_MODE gemini (external)
  Task: PROXY_MODE gpt-5-codex (external)

Message 3: Error Recovery (error-recovery skill)
  results = await Promise.allSettled([...]);

  Results:
    - Claude: Success ✓
    - Grok: Timeout after 30s ✗
    - Gemini: API 500 error ✗
    - GPT-5: Success ✓

  successful.length = 2 (Claude + GPT-5)
  2 ≥ 2 ✓ (threshold met, can proceed)

  Notify user:
    "2/4 models succeeded (Grok timeout, Gemini error).
     Proceeding with consolidation using 2 reviews."

Message 4: Auto-Consolidation
  Task: senior-code-reviewer
    Prompt: "Consolidate 2 reviews from:
             - ai-docs/reviews/claude-review.md
             - ai-docs/reviews/gpt5-review.md

             Note: Only 2 models (Grok and Gemini failed)."

Message 5: Present Results
  "Multi-model review complete (2/4 models succeeded).

   Top Issues (2-model consensus):
   1. [UNANIMOUS] SQL injection (both flagged)
   2. [DIVERGENT] Input validation (Claude only)
   3. [DIVERGENT] Rate limiting (GPT-5 only)

   Note: Grok and Gemini failed. Limited consensus data.
   See ai-docs/consolidated-review.md for details."
```

**Result:** Graceful degradation, useful results despite failures

---

## Troubleshooting

**Problem: Models executing sequentially instead of parallel**

Cause: Mixed tool types in Message 2

Solution: Use ONLY Task calls in Message 2

```
❌ Wrong:
  Message 2:
    TodoWrite({...})
    Task({...})
    Task({...})

✅ Correct:
  Message 1: TodoWrite({...}) (separate message)
  Message 2: Task({...}); Task({...}) (only Task)
```

---

**Problem: Agent returns before external model completes**

Cause: Background claudish execution

Solution: Use synchronous (blocking) execution

```
❌ Wrong:
  claudish --model grok ... &

✅ Correct:
  RESULT=$(claudish --model grok ...)
```

---

**Problem: Consolidation never triggers**

Cause: Waiting for user to request it

Solution: Auto-trigger when N ≥ 2 reviews complete

```
❌ Wrong:
  if (results.length >= 2) {
    notifyUser("Ready to consolidate. Proceed?");
    // Waits for user...
  }

✅ Correct:
  if (results.length >= 2) {
    // Auto-trigger, don't wait
    await consolidate();
  }
```

---

**Problem: Costs higher than estimated**

Cause: Underestimated output tokens

Solution: Use range-based estimates, bias toward high end

```
✅ Better Estimation:
  Output: 3,000 - 5,000 tokens (range, not single number)
  Cost: $0.005 - $0.010 (gives user realistic expectation)
```

---

## Summary

Multi-model validation achieves 3-5x speedup and consensus-based prioritization through:

- **4-Message Pattern** (true parallel execution)
- **Blocking proxy execution** (agents wait for external models)
- **Auto-consolidation** (triggered when N ≥ 2 reviews complete)
- **Consensus analysis** (unanimous → strong → majority → divergent)
- **Cost transparency** (estimate before, report after)
- **Error recovery** (graceful degradation on failures)

Master this skill and you can validate any implementation with multiple AI perspectives in minutes.

---

**Extracted From:**
- `/review` command (complete multi-model review orchestration)
- `CLAUDE.md` Parallel Multi-Model Execution Protocol
- `shared/skills/claudish-usage` (proxy mode patterns)
