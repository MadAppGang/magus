---
name: multi-agent-coordination
description: Coordinate multiple agents in parallel or sequential workflows. Use when running agents simultaneously, delegating to sub-agents, switching between specialized agents, or managing agent selection.
user-invocable: false
---

# Multi-Agent Coordination

**Version:** 1.0.0
**Purpose:** Patterns for coordinating multiple agents in complex workflows
**Status:** Production Ready

## Overview

Multi-agent coordination is the foundation of sophisticated Claude Code workflows. This skill provides battle-tested patterns for orchestrating multiple specialized agents to accomplish complex tasks that are beyond the capabilities of a single agent.

The key challenge in multi-agent systems is **dependencies**. Some tasks must execute sequentially (one agent's output feeds into another), while others can run in parallel (independent validations from different perspectives). Getting this right is the difference between a 5-minute workflow and a 15-minute one.

This skill teaches you:
- When to run agents in **parallel** vs **sequential**
- How to **select the right agent** for each task
- How to **delegate** to sub-agents without polluting context
- How to manage **context windows** across multiple agent calls

## Core Patterns

### Pattern 1: Sequential vs Parallel Execution

**When to Use Sequential:**

Use sequential execution when there are **dependencies** between agents:
- Agent B needs Agent A's output as input
- Workflow phases must complete in order (plan → implement → test → review)
- Each agent modifies shared state (same files)

**Example: Multi-Phase Implementation**

```
Phase 1: Architecture Planning
  Agent: dev:architect
    Output: ai-docs/architecture-plan.md
    Wait for completion ✓

Phase 2: Implementation (depends on Phase 1)
  Agent: dev:developer
    Input: Read ai-docs/architecture-plan.md
    Output: src/auth.ts, src/routes.ts
    Wait for completion ✓

Phase 3: Testing (depends on Phase 2)
  Agent: dev:test-architect
    Input: Read src/auth.ts, src/routes.ts
    Output: tests/auth.test.ts
```

**When to Use Parallel:**

Use parallel execution when agents are **independent**:
- Multiple validation perspectives (designer + tester + reviewer)
- Multiple AI models reviewing same code (Grok + Gemini + Claude)
- Multiple feature implementations in separate files

**Example: Multi-Perspective Validation — several reviewers, ONE target**

```
Single Message with Multiple Task Calls:

Agent(
  subagent_type: "dev:reviewer",
  run_in_background: false,
  description: "Code review",
  prompt: "TARGET: BRANCH
           FOCUS: code
           OUTPUT: ai-docs/reviews/code.md
           MODELS: none"
)
---
Agent(
  subagent_type: "dev:reviewer",
  run_in_background: false,
  description: "Security review",
  prompt: "TARGET: BRANCH
           FOCUS: security
           OUTPUT: ai-docs/reviews/security.md
           MODELS: none"
)
---
Agent(
  subagent_type: "dev:reviewer",
  run_in_background: false,
  description: "Plugin-quality review",
  prompt: "TARGET: BRANCH
           FOCUS: plugin
           OUTPUT: ai-docs/reviews/plugin.md
           MODELS: none"
)

All three execute simultaneously (3x speedup!)
Wait for all to complete, then hand the three output paths to `dev:synthesizer` on
REVIEWS: with `dev:reviewer`'s scale on THRESHOLDS: — the three lines under 'Apply
verdict thresholds' in that agent's file, read at dispatch time, never recalled —
and the consolidated file on OUTPUT:. It consolidates; none of the three reviewers
sees another's output. Without THRESHOLDS: it ends the report `VERDICT: none`.
```

Review consolidation takes reviews of ONE target that share a location, a severity
scale and a verdict vocabulary — here three `dev:reviewer` dispatches over the same
`TARGET:`, differing only in `FOCUS:`. Heterogeneous specialist reports — a Figma design
review, a browser usability test and a code review — share none of those; present them
side by side through a coordination summary, never feed them to review consolidation.

**The 4-Message Pattern for True Parallel Execution:**

This is **CRITICAL** for achieving true parallelism:

```
Message 1: Preparation (Bash Only)
  - Create workspace directories
  - Validate inputs
  - Write context files
  - NO Agent calls, NO Tasks

Message 2: Parallel Execution (Task Only)
  - Launch ALL agents in SINGLE message
  - ONLY Agent tool calls
  - Each Task is independent
  - All execute simultaneously

Message 3: Consolidation (Task Only)
  - Launch `dev:synthesizer` with every output path on REVIEWS:, the scale of
    the reviewer that wrote them on THRESHOLDS: (for `dev:reviewer`, the three
    lines under 'Apply verdict thresholds' in its agent file, read at dispatch
    time, never recalled) and the consolidated file on OUTPUT:
  - It is given the reviews, never the code; no reviewer consolidates
  - Automatically triggered when the agents complete — at N = 1 too, where it
    passes the single review through with a `VERDICT:` line

Message 4: Present Results
  - Show user final consolidated results
  - Include links to detailed reports
```

**Anti-Pattern: Mixing Tool Types Breaks Parallelism**

```
❌ WRONG - Executes Sequentially:
  await TaskCreate({...});  // Tool 1
  await Agent({...});       // Tool 2 - waits for Tasks
  await Bash({...});       // Tool 3 - waits for Task
  await Agent({...});       // Tool 4 - waits for Bash

✅ CORRECT - Executes in Parallel:
  await Agent({...});  // Task 1
  await Agent({...});  // Task 2
  await Agent({...});  // Task 3
  // All execute simultaneously
```

**Why Mixing Fails:**

Claude Code sees different tool types and assumes there are dependencies between them, forcing sequential execution. Using a single tool type (all Agent calls) signals that operations are independent and can run in parallel.

---

### Pattern 2: Agent Selection by Task Type

**Task Detection Logic:**

Intelligent workflows automatically detect task type and select appropriate agents:

```
Task Type Detection:

IF request mentions "API", "endpoint", "backend", "database":
  → API-focused workflow
  → Use: api-architect, backend-developer, test-architect
  → Skip: designer, ui-developer (not relevant)

ELSE IF request mentions "UI", "component", "design", "Figma":
  → UI-focused workflow
  → Use: designer, ui-developer, ui-manual-tester
  → Optional: ui-developer-codex (external validation)

ELSE IF request mentions both API and UI:
  → Mixed workflow
  → Use all relevant agents from both categories
  → Coordinate between backend and frontend agents

ELSE IF request mentions "test", "coverage", "bug":
  → Testing-focused workflow
  → Use: test-architect, ui-manual-tester
  → Optional: codebase-detective (for bug investigation)

ELSE IF request mentions "review", "validate", "feedback":
  → Review-focused workflow
  → Use: senior-code-reviewer, designer, ui-developer
  → Optional: external model reviewers
```

**Agent Capability Matrix:**

| Task Type | Primary Agent | Secondary Agent | Optional External |
|-----------|---------------|-----------------|-------------------|
| API Implementation | backend-developer | api-architect | - |
| UI Implementation | ui-developer | designer | ui-developer-codex |
| Testing | test-architect | ui-manual-tester | - |
| Code Review | senior-code-reviewer | - | codex-code-reviewer |
| Architecture Planning | api-architect OR frontend-architect | - | plan-reviewer |
| Bug Investigation | codebase-detective | test-architect | - |
| Design Validation | designer | ui-developer | designer-codex |

**Agent Switching Pattern:**

Some workflows benefit from **adaptive agent selection** based on context:

```
Example: UI Development with External Validation

Base Implementation:
  Agent: dev:frontend
    Prompt: Implement navbar component from design

User requests external validation:
  → Switch to ui-developer-codex OR add parallel ui-developer-codex
  → Run both: embedded ui-developer + external ui-developer-codex
  → Consolidate feedback from both

Scenario 1: User wants speed
  → Use ONLY ui-developer (embedded, fast)

Scenario 2: User wants highest quality
  → Use BOTH ui-developer AND ui-developer-codex (parallel)
  → Consensus analysis on feedback

Scenario 3: User is out of credits
  → Fallback to ui-developer only
  → Notify user external validation unavailable
```

---

### Pattern 3: Sub-Agent Delegation

**File-Based Instructions (Context Isolation):**

When delegating to sub-agents, use **file-based instructions** to avoid context pollution:

```
✅ CORRECT - File-Based Delegation:

Step 1: Write instructions to file
  Write: ai-docs/architecture-instructions.md
    Content: "Design authentication system with JWT tokens..."

Step 2: Delegate to agent with file reference
  Agent: dev:architect
    Prompt: "Read instructions from ai-docs/architecture-instructions.md
             and create architecture plan."

Step 3: Agent reads file, does work, writes output
  Agent reads: ai-docs/architecture-instructions.md
  Agent writes: ai-docs/architecture-plan.md

Step 4: Agent returns brief summary ONLY
  Return: "Architecture plan complete. See ai-docs/architecture-plan.md"

Step 5: Orchestrator reads output file if needed
  Read: ai-docs/architecture-plan.md
  (Only if orchestrator needs to process the output)
```

**Why File-Based?**

- **Avoids context pollution:** Long user requirements don't bloat orchestrator context
- **Reusable:** Multiple agents can read same instruction file
- **Debuggable:** Files persist after workflow completes
- **Clean separation:** Input file, output file, orchestrator stays lightweight

**Anti-Pattern: Inline Delegation**

```
❌ WRONG - Context Pollution:

Agent: dev:architect
  Prompt: "Design authentication system with:
    - JWT tokens with refresh token rotation
    - Email/password login with bcrypt hashing
    - OAuth2 integration with Google, GitHub
    - Rate limiting on login endpoint (5 attempts per 15 min)
    - Password reset flow with time-limited tokens
    - Email verification on signup
    - Role-based access control (admin, user, guest)
    - Session management with Redis
    - Security headers (CORS, CSP, HSTS)
    - ... (500 more lines of requirements)"

Problem: Orchestrator's context now contains 500+ lines of requirements
         that are only relevant to the architect agent.
```

**Brief Summary Returns:**

Sub-agents should return **2-5 sentence summaries**, not full output:

```
✅ CORRECT - Brief Summary:
  "Architecture plan complete. Designed 3-layer authentication:
   JWT with refresh tokens, OAuth2 integration (Google/GitHub),
   and Redis session management. See ai-docs/architecture-plan.md
   for detailed component breakdown."

❌ WRONG - Full Output:
  "Architecture plan:
   [500 lines of detailed architecture documentation]
   Components: AuthController, TokenService, OAuthService...
   [another 500 lines]"
```

**External Model Invocation:**

For external AI models, the orchestrating command (/team, /delegate) handles invocation
via claudish MCP tools. Sub-agents do NOT invoke claudish directly.

```
/team command:
  1. Uses `team` MCP tool with model list and vote prompt
  2. team tool runs all external models in parallel internally
  3. Results returned as structured per-model responses
  4. Sub-agents only handle internal Claude work via Agent tool

/delegate command:
  1. Uses `create_session` MCP tool with model and prompt
  2. Channel events notify on progress (tool_executing, input_required, completed)
  3. `get_output(session_id)` retrieves the result
```

**Key:** External model execution is handled by the MCP server, not by sub-agents.
Sub-agents receive their work context through Task prompts and write results to files.

---

### Pattern 4: Context Window Management

**When to Delegate:**

Delegate to sub-agents when:
- Task is self-contained (clear input → output)
- Output is large (architecture plan, test suite, review report)
- Task requires specialized expertise (designer, tester, reviewer)
- Multiple independent tasks can run in parallel

**When to Execute in Main Context:**

Execute in main orchestrator when:
- Task is small (simple file edit, command execution)
- Output is brief (yes/no decision, status check)
- Task depends on orchestrator state (current phase, iteration count)
- Context pollution risk is low

**Context Size Estimation:**

**Note:** Token estimates below are approximations based on typical usage. Actual context consumption varies by skill complexity, Claude model version, and conversation history. Use these as guidelines, not exact measurements.

Estimate context usage to decide delegation strategy:

```
Context Budget: ~200k tokens (Claude Sonnet 4.5 - actual varies by model)

Current context usage breakdown:
  - System prompt: 10k tokens
  - Skill content (5 skills): 10k tokens
  - Command instructions: 5k tokens
  - User request: 1k tokens
  - Conversation history: 20k tokens
  ───────────────────────────────────
  Total used: 46k tokens
  Remaining: 154k tokens

Safe threshold for delegation: If task will consume >30k tokens, delegate

Example: Architecture planning for large system
  - Requirements: 5k tokens
  - Expected output: 20k tokens
  - Total: 25k tokens
  ───────────────────────────────────
  Decision: Delegate (keeps orchestrator lightweight)
```

**Delegation Strategy by Context Size:**

| Task Output Size | Strategy |
|------------------|----------|
| < 1k tokens | Execute in orchestrator |
| 1k - 10k tokens | Delegate with summary return |
| 10k - 30k tokens | Delegate with file-based output |
| > 30k tokens | Multi-agent decomposition |

**Example: Multi-Agent Decomposition**

```
User Request: "Implement complete e-commerce system"

This is >100k tokens if done by single agent. Decompose:

Phase 1: Break into sub-systems
  - Product catalog
  - Shopping cart
  - Checkout flow
  - User authentication
  - Order management
  - Payment integration

Phase 2: Delegate each sub-system to separate agent
  Agent: dev:developer
    Instruction file: ai-docs/product-catalog-requirements.md
    Output file: ai-docs/product-catalog-implementation.md

  Agent: dev:developer
    Instruction file: ai-docs/shopping-cart-requirements.md
    Output file: ai-docs/shopping-cart-implementation.md

  ... (6 parallel agent invocations)

Phase 3: Integration agent
  Agent: dev:developer
    Instruction: "Integrate 6 sub-systems. Read output files:
                  ai-docs/*-implementation.md"
    Output: ai-docs/integration-plan.md

Total context per agent: ~20k tokens (manageable)
vs. Single agent: 120k+ tokens (context overflow risk)
```

---

## Integration with Other Skills

**multi-agent-coordination + multi-model-validation:**

```
Use Case: Code review with multiple AI models

Step 1: Agent Selection (multi-agent-coordination)
  - Detect task type: Code review
  - Select agents: senior-code-reviewer (embedded) + external models

Step 2: Parallel Execution (multi-model-validation)
  - Follow 4-Message Pattern
  - Launch all reviewers simultaneously
  - Wait for all to complete

Step 3: Consolidation (multi-model-validation)
  - Auto-consolidate reviews
  - Apply consensus analysis
```

**multi-agent-coordination + quality-gates:**

```
Use Case: Iterative UI validation

Step 1: Agent Selection (multi-agent-coordination)
  - Detect task type: UI validation
  - Select agents: designer, ui-developer

Step 2: Iteration Loop (quality-gates)
  - Run designer validation
  - If not PASS: delegate to ui-developer for fixes
  - Loop until PASS or max iterations

Step 3: User Validation Gate (quality-gates)
  - MANDATORY user approval
  - Collect feedback if issues found
```

**multi-agent-coordination + task-orchestration:**

```
Use Case: Multi-phase implementation workflow

Step 1: Initialize Tasks (task-orchestration)
  - Create task list for all phases

Step 2: Sequential Agent Delegation (multi-agent-coordination)
  - Phase 1: api-architect
  - Phase 2: backend-developer (depends on Phase 1)
  - Phase 3: test-architect (depends on Phase 2)
  - TaskUpdate after each phase
```

---

## Best Practices

**Do:**
- ✅ Use parallel execution for independent tasks (3-5x speedup)
- ✅ Use sequential execution when there are dependencies
- ✅ Use file-based instructions to avoid context pollution
- ✅ Return brief summaries (2-5 sentences) from sub-agents
- ✅ Select agents based on task type (API/UI/Testing/Review)
- ✅ Decompose large tasks into multiple sub-agent calls
- ✅ Estimate context usage before delegating

**Don't:**
- ❌ Mix tool types in parallel execution (breaks parallelism)
- ❌ Inline long instructions in Task prompts (context pollution)
- ❌ Return full output from sub-agents (use files instead)
- ❌ Use parallel execution for dependent tasks (wrong results)
- ❌ Use single agent for >100k token tasks (context overflow)
- ❌ Forget to wait for all parallel tasks before consolidating

**Performance Tips:**
- Parallel execution: 3-5x faster than sequential (5min vs 15min)
- File-based delegation: Saves 50-80% context usage
- Agent switching: Adapt to user preferences (speed vs quality)
- Context decomposition: Enables tasks that would otherwise overflow

---

## Examples

### Example 1: Parallel Multi-Model Code Review

**Scenario:** User requests "Review my authentication code with Grok and Gemini"

**Agent Selection:**
- Task type: Code review
- Agents: senior-code-reviewer (embedded), external Grok, external Gemini

**Execution:**

```
Message 1: Preparation
  - No code capture: every reviewer is handed TARGET: BRANCH and runs dev's
    capture-review-surfaces.ts itself, in BRANCH mode
  - Write the externals' brief once, to ai-docs/review-panel/prompt.md — the same
    TARGET / FOCUS lines the internal reviewer gets, with MODELS: none (an external
    is told nothing about the panel, and no reviewer launches other reviewers)

Message 2: Parallel Execution (the internal Agent call and the claudish MCP
  `team` call in ONE message — never the claudish CLI, which does not run tasks)
  Agent(
    subagent_type: "dev:reviewer",
    run_in_background: false,
    description: "Security review",
    prompt: "TARGET: BRANCH
             FOCUS: security
             OUTPUT: ai-docs/claude-review.md
             MODELS: grok,gemini"
  )
  ---
  claudish team(mode="run", path="ai-docs/review-panel",
    models=["grok", "gemini"],
    agent="dev:reviewer",
    input_file="ai-docs/review-panel/prompt.md",
    require_pattern="\*\*Verdict\*\*: (PASS|CONDITIONAL|FAIL)",
    min_output_bytes=400)

  All 3 execute simultaneously (3x faster than sequential). `run` returns as soon
  as the slots start: poll team(mode="status", path="ai-docs/review-panel") until
  no slot has state RUNNING, then read ai-docs/review-panel/response-<slot>.md for
  each slot that completed (procedure: claudish:claudish-usage → "The three-step
  lifecycle").

Message 3: Auto-Consolidation
  # The synthesizer is given the three reviews and never the code.
  Agent(
    subagent_type: "dev:synthesizer",
    run_in_background: false,
    description: "Consolidate code reviews",
    prompt: "REVIEWS: ai-docs/claude-review.md
             ai-docs/review-panel/response-<slot>.md   (one line per slot that completed)
             THRESHOLDS: <the three lines under 'Apply verdict thresholds' in
                          dev:reviewer's agent file, read at dispatch time, never
                          recalled>
             OUTPUT: ai-docs/consolidated-review.md
             Consolidate with consensus levels (unanimous / strong / majority / divergent).
             Compute the verdict line from your counts against THRESHOLDS.
             You are given reviews, never code. Do not review."
  )

Message 4: Present Results
  "Review complete. 3 models analyzed your code.
   Top 5 issues by consensus:
   1. [UNANIMOUS] Missing input validation on login endpoint
   2. [STRONG] SQL injection risk in user query
   3. [MAJORITY] Weak password requirements
   See ai-docs/consolidated-review.md for details."
```

**Result:** 5 minutes total (vs 15+ if sequential), consensus-based prioritization

---

### Example 2: Sequential Multi-Phase Implementation

**Scenario:** User requests "Implement payment integration feature"

**Agent Selection:**
- Task type: API implementation
- Agents: api-architect → backend-developer → test-architect → senior-code-reviewer

**Execution:**

```
Phase 1: Architecture Planning
  Write: ai-docs/payment-requirements.md
    "Integrate Stripe payment processing with webhook support..."

  Agent: dev:architect
    Prompt: "Read ai-docs/payment-requirements.md
             Create architecture plan"
    Output: ai-docs/payment-architecture.md
    Return: "Architecture plan complete. Designed 3-layer payment system."

  Wait for completion ✓

Phase 2: Implementation (depends on Phase 1)
  Agent: dev:developer
    Prompt: "Read ai-docs/payment-architecture.md
             Implement payment integration"
    Output: src/payment.ts, src/webhooks.ts
    Return: "Payment integration implemented. 2 new files, 500 lines."

  Wait for completion ✓

Phase 3: Testing (depends on Phase 2)
  Agent: dev:test-architect
    Prompt: "Write tests for src/payment.ts and src/webhooks.ts"
    Output: tests/payment.test.ts, tests/webhooks.test.ts
    Return: "Test suite complete. 20 tests covering payment flows."

  Wait for completion ✓

Phase 4: Code Review (depends on Phase 3)
  Agent(
    subagent_type: "dev:reviewer",
    run_in_background: false,
    description: "Review payment integration",
    prompt: "TARGET: src/payment.ts, src/webhooks.ts, tests/payment.test.ts, tests/webhooks.test.ts
             FOCUS: code
             OUTPUT: ai-docs/payment-review.md"
  )
    Return: "Review complete. 2 MEDIUM issues found."

  Wait for completion ✓
```

**Result:** Sequential execution ensures each phase has correct inputs

---

### Example 3: Adaptive Agent Switching

**Scenario:** User requests "Validate navbar implementation" with optional external AI

**Agent Selection:**
- Task type: UI validation
- Base agent: designer
- Optional: designer-codex (if user wants external validation)

**Execution:**

```
Step 1: Ask user preference, then make the directory both paths name (Bash only)
  "Do you want external AI validation? (Yes/No)"
  mkdir -p ai-docs/design-panel/claude-internal
  # design-review creates OUTPUT_DIR itself only when it was given none; a caller
  # that names one creates it.

Step 2a: If user says NO (speed mode)
  # designer:design-review reads no `Output:` line. It takes OUTPUT_DIR and writes
  # its report, summary.md, into that directory beside the images and JSON it measured.
  Agent(
    subagent_type: "designer:design-review",
    run_in_background: false,
    description: "Design review: navbar",
    prompt: "REFERENCE_SOURCE: <the Figma URL, image path or browser URL>
             IMPL_SOURCE: <the implementation URL or image path>
             OUTPUT_DIR: ai-docs/design-panel/claude-internal
             This is READ-ONLY analysis of the two sources named. Write only under OUTPUT_DIR."
  )
  The review is ai-docs/design-panel/claude-internal/summary.md. N = 1 still goes
  through dev:synthesizer — Message 2 below with that one path on REVIEWS: — which
  passes the review through and appends the VERDICT: line, so the output has the
  same shape as the quality mode's.

Step 2b: If user says YES (quality mode)
  Message 1: Parallel Validation — the internal Agent call and the claudish MCP
    `team` call in ONE message (never the claudish CLI, which does not run tasks)
    Agent(
      subagent_type: "designer:design-review",
      run_in_background: false,
      description: "Design review: navbar — internal",
      prompt: "REFERENCE_SOURCE: <the Figma URL, image path or browser URL>
               IMPL_SOURCE: <the implementation URL or image path>
               OUTPUT_DIR: ai-docs/design-panel/claude-internal
               This is READ-ONLY analysis of the two sources named. Write only under OUTPUT_DIR."
    )
    ---
    claudish team(mode="run", path="ai-docs/design-panel",
      models=["<the model the user named, resolved against the live catalog>"],
      agent="designer:design-review",
      input_file="ai-docs/design-panel/prompt.md",
      require_pattern="Diff [Pp]ercentage.*[0-9.]+%",
      min_output_bytes=400)
    require_pattern pins the Diff Percentage row — the line every design review
    carries, with or without a vision key, and one of the two the synthesizer
    keys on. Never pin "Overall Score": design-review writes it only when semantic
    analysis ran, so a pixel-only slot the synthesizer would count is reported
    FAILED before it reaches REVIEWS:.
    prompt.md carries the same REFERENCE_SOURCE and IMPL_SOURCE lines; claudish
    captures each slot's returned report itself. Poll team(mode="status",
    path="ai-docs/design-panel") until no slot has state RUNNING; each completed
    slot's review is ai-docs/design-panel/response-<slot>.md.

  Message 2: Consolidate — dev:synthesizer, never a reviewer
    # It is given the reviews and never the screens or the code.
    Agent(
      subagent_type: "dev:synthesizer",
      run_in_background: false,
      description: "Consolidate design reviews",
      prompt: "REVIEWS: ai-docs/design-panel/claude-internal/summary.md
               ai-docs/design-panel/response-<slot>.md   (one line per slot that completed)
               THRESHOLDS: <designer:design-review's own PASS | WARN | FAIL | CRITICAL
                            scale — the four difference-percentage rows under
                            severity_thresholds in that agent's file, read at
                            dispatch time, never recalled>
               OUTPUT: ai-docs/design-panel/consolidated.md
               Consolidate with consensus levels (unanimous / strong / majority / divergent).
               Compute the verdict line against THRESHOLDS and emit the word that
               scale names — PASS, WARN, FAIL or CRITICAL, never a code-review word.
               You are given reviews, never code. Do not review."
    )
    Return: "Consolidated review complete. Both agree on 1 CRITICAL issue."

Step 3: User validation
  Present ai-docs/design-panel/consolidated.md to user for approval
```

**Result:** Adaptive workflow based on user preference (speed vs quality)

---

## Troubleshooting

**Problem: Parallel tasks executing sequentially**

Cause: Mixed tool types in same message

Solution: Use 4-Message Pattern with ONLY Agent calls in Message 2

```
❌ Wrong:
  await TaskCreate({...});
  await Agent({...});
  await Agent({...});

✅ Correct:
  Message 1: await Bash({...});  (prep only)
  Message 2: await Agent({...}); await Agent({...}); (parallel)
```

---

**Problem: Orchestrator context overflowing**

Cause: Inline instructions or full output returns

Solution: Use file-based delegation + brief summaries

```
❌ Wrong:
  Agent: <agent-n>
    Prompt: "[1000 lines of inline requirements]"
  Return: "[500 lines of full output]"

✅ Correct:
  Write: ai-docs/requirements.md
  Agent: <agent-n>
    Prompt: "Read ai-docs/requirements.md"
  Return: "Complete. See ai-docs/output.md"
```

---

**Problem: Wrong agent selected for task**

Cause: Task type detection failed

Solution: Explicitly detect task type using keywords

```
Check user request for keywords:
  - API/endpoint/backend → api-architect, backend-developer
  - UI/component/design → designer, ui-developer
  - test/coverage → test-architect
  - review/validate → senior-code-reviewer

Default: Ask user to clarify task type
```

---

**Problem: Agent returns before external model completes**

Cause: Not waiting for channel events from MCP session.

Solution: The orchestrating command (/team, /delegate) waits for the `completed` channel event
before presenting results. Sub-agents do not invoke external models directly — the command
handles this via MCP tools.

---

## Summary

Multi-agent coordination is about choosing the right execution strategy:

- **Parallel** when tasks are independent (3-5x speedup)
- **Sequential** when tasks have dependencies (correct results)
- **File-based delegation** to avoid context pollution (50-80% savings)
- **Brief summaries** from sub-agents (clean orchestrator context)
- **Task type detection** for intelligent agent selection
- **Context decomposition** for large tasks (avoid overflow)

Master these patterns and you can orchestrate workflows of any complexity.

---

**Extracted From:**
- `/implement` command (task detection, sequential workflows)
- `/validate-ui` command (adaptive agent switching)
- `/review` command (parallel execution, 4-Message Pattern)
- `CLAUDE.md` Parallel Multi-Model Execution Protocol
