---
name: task-complexity-router
description: Complexity-based task routing for optimal model selection and cost efficiency. Use when deciding which model tier to use, analyzing task complexity, optimizing API costs, or implementing tiered routing. Trigger keywords - "routing", "complexity", "model selection", "tier", "cost optimization", "haiku", "sonnet", "opus", "task analysis".
version: 0.1.0
tags: [orchestration, routing, complexity, model-selection, cost-optimization, tiered]
keywords: [routing, complexity, model-selection, tier, cost, haiku, sonnet, opus, optimization, task-analysis]
plugin: multimodel
updated: 2026-01-28
---

# Task Complexity Router

**Version:** 1.0.0
**Purpose:** Intelligent task routing to optimal model tiers for cost efficiency and performance
**Status:** Production Ready

## Overview

Task complexity routing is the practice of **matching tasks to appropriate model tiers** based on complexity, urgency, and resource requirements. Instead of using expensive premium models for all tasks, routing directs simple tasks to fast/cheap models and reserves expensive models for complex work.

This skill provides battle-tested patterns for:
- **4-tier routing system** (Native Tools → Haiku → Sonnet → Opus)
- **Complexity detection heuristics** (keyword-based + context-based)
- **Cost optimization strategies** (save 60-90% on API costs)
- **Dynamic tier escalation** (upgrade when task stalls or fails)
- **Routing integration** (works with multi-agent-coordination, quality-gates, proxy-mode)

Well-designed routing can **reduce AI costs by 60-90%** while maintaining quality, since 70% of tasks can be handled by faster, cheaper models.

## Why Task Routing Matters

### Cost Comparison (per 1M tokens)

| Model Tier | Model Example | Cost (Input/Output) | Speed | Use Case |
|------------|---------------|---------------------|-------|----------|
| **Tier 0** | Native Tools | $0 | Instant | File operations, searches, formatting |
| **Tier 1** | Claude Haiku 4.5 | $0.80 / $4.00 | Fast | Simple edits, docs, straightforward tasks |
| **Tier 2** | Claude Sonnet 4.5 | $3.00 / $15.00 | Moderate | Standard dev, multi-file changes |
| **Tier 3** | Claude Opus 4.5 | $15.00 / $75.00 | Slower | Architecture, complex debugging, audits |

**Example Cost Savings:**

```
Scenario: 100 tasks per day (mix of simple and complex)

Without Routing (all Sonnet):
  100 tasks × 1000 tokens avg × $0.015 = $1.50/day
  Annual: $547.50

With Smart Routing:
  50 tasks (native tools) × $0 = $0
  30 tasks (Haiku) × $0.004 = $0.12
  15 tasks (Sonnet) × $0.015 = $0.22
  5 tasks (Opus) × $0.075 = $0.37
  Total: $0.71/day
  Annual: $259.15

Savings: $288.35/year (52% reduction) for single developer
```

### Performance Benefits

Beyond cost savings, routing improves:
- **Speed:** Fast models return results in 1-2s vs 10-15s for premium
- **Throughput:** Process 5x more simple tasks in parallel
- **Resource efficiency:** Save premium model quota for critical tasks
- **User experience:** Instant results for simple operations

## The 4-Tier Routing System

### Tier 0: Native Tools (No LLM)

**When to Use:**
- File operations (search, rename, move, copy)
- Content search (grep, regex)
- Code formatting (prettier, black, go fmt)
- Git operations (status, log, diff)
- Single-file edits with clear pattern

**Indicators:**
- Keywords: "find", "search", "format", "rename", "list", "show"
- Patterns: Single regex, exact string replacement, file path operations

**Cost:** $0
**Speed:** Instant (< 0.1s)

**Examples:**
```
✓ "Find all .tsx files in src/"
✓ "Search for 'TODO' comments"
✓ "Format code with prettier"
✓ "Rename Button.js to Button.tsx"
✓ "Show git status"
✓ "Replace 'oldName' with 'newName' in file.ts"
```

**Implementation:**
```
Task: "Find all TypeScript files"
→ Use Glob tool: *.ts
→ No LLM needed

Task: "Search for API endpoints"
→ Use Grep tool: "app\.(get|post|put|delete)"
→ No LLM needed

Task: "Format all code"
→ Use Bash: bun run format
→ No LLM needed
```

---

### Tier 1: Fast Model (Haiku)

**When to Use:**
- Simple code changes (add comment, fix typo, rename variable)
- Documentation updates (README, JSDoc, inline comments)
- Straightforward bug fixes (missing import, syntax error)
- Code explanation (what does this function do?)
- Simple test writing (unit test for pure function)

**Indicators:**
- Keywords: "simple", "basic", "small", "quick", "minor", "add", "fix", "update"
- Scope: Single file, < 50 lines changed
- Complexity: No architectural decisions, clear solution

**Cost:** ~$0.0004 per task (1000 tokens)
**Speed:** Fast (1-3s response time)

**Examples:**
```
✓ "Add JSDoc comment to calculateTotal function"
✓ "Fix typo in error message"
✓ "Rename getUserData to fetchUserData"
✓ "Update README with new installation steps"
✓ "Add missing import statement"
✓ "Write unit test for add(a, b) function"
```

**Anti-Patterns (Don't Use Haiku For):**
```
✗ "Design authentication system" (needs Opus)
✗ "Refactor entire codebase" (needs Sonnet + context)
✗ "Debug complex race condition" (needs Opus)
✗ "Architect database schema" (needs Opus)
```

---

### Tier 2: Standard Model (Sonnet)

**When to Use:**
- Standard feature implementation (new component, API endpoint)
- Multi-file refactoring (rename class, extract service)
- Integration tasks (connect frontend to backend)
- Moderate bug fixes (logic errors, edge cases)
- Test suites (integration tests, E2E tests)

**Indicators:**
- Keywords: "implement", "create", "build", "refactor", "integrate", "develop"
- Scope: 2-10 files, 50-500 lines changed
- Complexity: Requires understanding context, moderate problem-solving

**Cost:** ~$0.003 per task (1000 tokens)
**Speed:** Moderate (5-10s response time)

**Examples:**
```
✓ "Implement user profile page with React"
✓ "Create REST API endpoint for /users/:id"
✓ "Refactor authentication logic into AuthService"
✓ "Fix pagination bug in user list"
✓ "Write integration tests for payment flow"
✓ "Add error handling to API calls"
```

**This is the Default Tier:**
When in doubt, use Sonnet. It handles 70% of standard development tasks well.

---

### Tier 3: Premium Model (Opus)

**When to Use:**
- Architecture decisions (system design, database schema)
- Complex debugging (race conditions, memory leaks, security issues)
- Security audits (vulnerability analysis, threat modeling)
- Performance optimization (algorithm complexity, bottleneck analysis)
- Code review (deep analysis, architectural feedback)
- Critical bug fixes (production outages, data corruption)

**Indicators:**
- Keywords: "architect", "design", "audit", "complex", "system-wide", "critical", "optimize"
- Scope: System-wide impact, 10+ files, architectural changes
- Complexity: Requires deep reasoning, multiple trade-offs

**Cost:** ~$0.015 per task (1000 tokens)
**Speed:** Slower (15-30s response time)

**Examples:**
```
✓ "Design microservices architecture for e-commerce platform"
✓ "Audit authentication system for security vulnerabilities"
✓ "Debug intermittent race condition in WebSocket handler"
✓ "Optimize algorithm for 1M+ record processing"
✓ "Review entire codebase for architectural issues"
✓ "Design database schema for multi-tenant SaaS"
```

**When to Escalate to Opus:**
```
Task starts in Sonnet, but:
  - Task fails after 2 attempts → Escalate to Opus
  - User explicitly says "this is complex" → Escalate to Opus
  - Implementation reveals architectural issues → Escalate to Opus
  - Performance/security concerns discovered → Escalate to Opus
```

---

## Complexity Detection Heuristics

### Keyword-Based Routing

**Scoring Algorithm:**

```
Step 1: Extract keywords from user request

Step 2: Score each keyword:
  Tier 0 indicators: +0 points
    - find, search, list, show, format, rename, move, copy, grep

  Tier 1 indicators: +1 point
    - simple, basic, small, quick, minor, add, fix, update, comment

  Tier 2 indicators: +2 points
    - implement, create, build, refactor, integrate, develop, feature

  Tier 3 indicators: +3 points
    - architect, design, audit, complex, system-wide, critical, optimize

Step 3: Calculate total score
  Score 0: Use native tools (Tier 0)
  Score 1-2: Use Haiku (Tier 1)
  Score 3-5: Use Sonnet (Tier 2)
  Score 6+: Use Opus (Tier 3)

Step 4: Apply context modifiers (next section)
```

**Example Scoring:**

```
Request: "Add simple comment to function"
Keywords: "add" (+1), "simple" (+1), "comment" (+1)
Score: 3 → Sonnet (Tier 2)
Context Modifier: Single file → -1 → Score 2 → Haiku (Tier 1)

Request: "Implement user authentication"
Keywords: "implement" (+2), "authentication" (+3)
Score: 5 → Sonnet (Tier 2)

Request: "Design microservices architecture"
Keywords: "design" (+3), "microservices" (+3), "architecture" (+3)
Score: 9 → Opus (Tier 3)

Request: "Find all TODO comments"
Keywords: "find" (+0)
Score: 0 → Native tools (Tier 0)
```

---

### Context-Based Routing

**File Count Modifier:**

```
Files affected (from user context or codebase analysis):
  1 file → -1 tier (simpler)
  2-5 files → No modifier
  6-10 files → +0 tier (standard)
  11+ files → +1 tier (complex)

Example:
  Task: "Refactor authentication" (base Tier 2)
  Context: Affects 15 files
  Modifier: +1 tier → Opus (Tier 3)
```

**Code Complexity Modifier:**

```
Indicators of complexity (increase tier):
  - Async/await patterns (+1)
  - Error handling required (+1)
  - Database transactions (+1)
  - Security implications (+2)
  - Performance critical (+2)
  - System-wide impact (+2)

Example:
  Task: "Fix login bug" (base Tier 2)
  Context: Security implications (+2)
  Final: Opus (Tier 3)
```

**User Context Modifier:**

```
User explicitly signals complexity:
  "This is simple" → -1 tier
  "This is complex" → +1 tier
  "Be careful" → +1 tier
  "Quick task" → -1 tier
  "Critical" → +1 tier

Example:
  Task: "Update README" (base Tier 1)
  User: "Be careful, this affects onboarding"
  Modifier: +1 tier → Sonnet (Tier 2)
```

---

### Override Patterns

**User-Specified Model:**

```
User explicitly requests tier:
  "Use Haiku to add comment"
  → Override routing, use Haiku (Tier 1)

  "Use Opus to review this"
  → Override routing, use Opus (Tier 3)

Priority: User override > Routing algorithm
```

**Fallback Strategy:**

```
When routing is uncertain:
  - Score is borderline (e.g., 2.5 between tiers)
  - Mixed signals (simple keywords, complex context)
  - No clear indicators

Action: Default to Sonnet (Tier 2)
  - Safe choice for most tasks
  - Not too expensive ($0.003 vs $0.015)
  - Good quality for standard work
  - Can escalate to Opus if needed
```

**Emergency Escalation:**

```
Task fails at current tier:
  Attempt 1: Use routed tier (e.g., Haiku)
  Attempt 2: Same tier, different approach
  Attempt 3: Escalate +1 tier (e.g., Sonnet)
  Attempt 4: Escalate to Opus (highest tier)

Example:
  Task: "Fix subtle bug" → Haiku (Tier 1)
  Result: Fails to identify root cause
  → Retry with Haiku (different prompt)
  Result: Still fails
  → Escalate to Sonnet (Tier 2)
  Result: Identifies bug, fixes it ✓
```

---

## Cost Optimization Patterns

### Cost-Benefit Analysis

**When to Upgrade Tier:**

```
Upgrade from Tier 1 (Haiku) to Tier 2 (Sonnet):
  Cost increase: $0.002 (0.5x more)

  Upgrade when:
    - Task failed 2+ times at Tier 1
    - Task requires multi-file context
    - Risk of incorrect solution is high
    - Time spent debugging > cost savings

Upgrade from Tier 2 (Sonnet) to Tier 3 (Opus):
  Cost increase: $0.012 (5x more)

  Upgrade when:
    - Task has critical security/performance implications
    - Architecture decisions needed
    - Task failed 2+ times at Tier 2
    - Complex reasoning required (trade-offs, edge cases)
```

**When to Downgrade Tier:**

```
Downgrade from Tier 2 (Sonnet) to Tier 1 (Haiku):
  Cost savings: $0.002 (50% reduction)

  Downgrade when:
    - Subtask is simpler than parent task
    - Clear, straightforward solution exists
    - Single file, < 50 lines changed
    - No architectural decisions needed

Example:
  Main task: "Implement user profile" → Sonnet (Tier 2)
  Subtask 1: "Add JSDoc to ProfileCard" → Haiku (Tier 1)
  Subtask 2: "Write unit test for formatDate" → Haiku (Tier 1)
  Subtask 3: "Integrate with API" → Sonnet (Tier 2)
```

---

### Cost Tracking Integration

**Track Costs Per Task:**

```
Task: "Implement user authentication"
Model: Claude Sonnet 4.5
Tokens: 1500 input, 3000 output
Cost: (1500 × $0.003 / 1000) + (3000 × $0.015 / 1000)
     = $0.0045 + $0.045
     = $0.0495

Log to performance tracking:
  {
    "task": "Implement user authentication",
    "tier": 2,
    "model": "claude-sonnet-4-5",
    "tokens_in": 1500,
    "tokens_out": 3000,
    "cost": 0.0495,
    "duration_seconds": 8,
    "success": true
  }
```

**Aggregate Cost Metrics:**

```
Daily Cost Report:
  Tier 0 (Native): 45 tasks, $0.00
  Tier 1 (Haiku): 30 tasks, $0.12 ($0.004 avg)
  Tier 2 (Sonnet): 20 tasks, $0.60 ($0.030 avg)
  Tier 3 (Opus): 5 tasks, $0.75 ($0.150 avg)

  Total: 100 tasks, $1.47
  Routing efficiency: 75% tasks in Tier 0-1 (cheap)
```

**Cost Optimization Insights:**

```
Analysis: Top 5 expensive tasks
  1. "Design database schema" - Opus - $0.25
  2. "Security audit" - Opus - $0.20
  3. "Refactor auth system" - Sonnet - $0.08
  4. "Implement profile page" - Sonnet - $0.06
  5. "Debug race condition" - Opus - $0.15

Recommendation:
  - Tasks 1-2 correctly used Opus (architecture + security)
  - Task 3 could have been split into subtasks (Haiku for simple parts)
  - Task 5 correctly escalated to Opus after Sonnet failed
```

---

## Integration with Orchestration Plugin

### Routing + Multi-Agent Coordination

**Pattern: Task Delegation with Routing**

```
Workflow: Implement feature with multiple agents

Step 1: Architect designs system (Tier 3 - Opus)
  Task: "Design authentication architecture"
  Model: Opus (complex, architectural)
  Output: Architecture plan

Step 2: Split into subtasks with routing
  Subtask 1: "Implement JWT service" → Sonnet (Tier 2)
  Subtask 2: "Add JSDoc comments" → Haiku (Tier 1)
  Subtask 3: "Write unit tests" → Haiku (Tier 1)
  Subtask 4: "Integrate with API" → Sonnet (Tier 2)

Step 3: Delegate to appropriate agents
  backend-developer (Sonnet): Subtasks 1, 4
  documenter (Haiku): Subtask 2
  test-writer (Haiku): Subtask 3

Cost:
  Without routing: 4 tasks × Sonnet = $0.12
  With routing: 1×Opus ($0.015) + 2×Sonnet ($0.06) + 2×Haiku ($0.008) = $0.083
  Savings: 31%
```

---

### Routing + Multi-Model Validation

**Pattern: Tiered Review for Cost Efficiency**

```
Use Case: Code review with budget constraints

Step 1: Fast pre-review (Tier 1 - Haiku)
  Task: "Check for obvious issues: syntax, imports, formatting"
  Model: Haiku (fast, cheap)
  Output: Found 3 obvious issues (missing import, typo, formatting)

Step 2: Fix obvious issues
  Developer fixes issues found by Haiku

Step 3: Deep review (Tier 3 - Opus)
  Task: "Security audit and architectural review"
  Model: Opus (complex, critical)
  Output: Found 2 security issues

Cost:
  Without tiering: Opus review all issues = $0.025
  With tiering: Haiku pre-review ($0.001) + Opus deep review ($0.015) = $0.016
  Savings: 36%
  Benefit: Haiku caught simple issues fast, Opus focused on complex issues
```

---

### Routing + Quality Gates

**Pattern: Escalation on Failure**

```
Workflow: Test-driven development with escalation

Iteration 1: Run tests (Tier 2 - Sonnet)
  Task: "Analyze test failures and fix"
  Model: Sonnet
  Result: Fixed 8/10 failures
  Cost: $0.003

Iteration 2: Re-run tests (Tier 2 - Sonnet)
  Task: "Fix remaining 2 failures"
  Model: Sonnet
  Result: Still failing (complex race condition)
  Cost: $0.003

Iteration 3: Escalate to Opus (Tier 3)
  Task: "Debug complex race condition"
  Model: Opus (escalated due to failure)
  Result: Identified root cause, fixed ✓
  Cost: $0.015

Total Cost: $0.021
Without escalation: 3 × Opus = $0.045 (214% more expensive)
With escalation: Try cheaper first, upgrade only when needed
```

---

### Routing + Proxy Mode

**Pattern: External Model Routing**

```
Use Case: Use external fast models for simple tasks

Task: "Add comments to functions"
Complexity: Simple (Tier 1)

Option 1: Claude Haiku 4.5 (OpenRouter)
  Cost: $0.004
  Speed: 2s

Option 2: DeepSeek Coder (OpenRouter)
  Cost: $0.001 (75% cheaper than Haiku)
  Speed: 3s

Option 3: Grok Code Fast (OpenRouter)
  Cost: $0.002 (50% cheaper than Haiku)
  Speed: 1s (fastest)

Routing Decision:
  If speed priority: Use Grok Code Fast
  If cost priority: Use DeepSeek Coder
  If balance: Use Claude Haiku (best quality/cost/speed)

Implementation:
  Task: task-executor
    Model: grok-code-fast-1
    Prompt: "Add JSDoc comments to all functions in UserService.ts"
    claudish: x-ai/grok-code-fast-1
```

---

## Best Practices

**Do:**
- ✅ Use native tools (Tier 0) for file operations and searches (instant, free)
- ✅ Start with cheaper tiers and escalate only when needed
- ✅ Track costs per task for optimization insights
- ✅ Set max cost budgets per workflow (e.g., $0.10 per feature)
- ✅ Split complex tasks into simpler subtasks (route each separately)
- ✅ Use Haiku for documentation, comments, simple tests
- ✅ Use Sonnet as default for standard development
- ✅ Reserve Opus for architecture, security, complex debugging
- ✅ Escalate tier after 2 failures at current tier
- ✅ Document routing decisions for team alignment

**Don't:**
- ❌ Use Opus for every task (waste money, slower)
- ❌ Use Haiku for complex tasks (will fail, waste time)
- ❌ Ignore user context (security/critical tasks need higher tier)
- ❌ Skip cost tracking (can't optimize what you don't measure)
- ❌ Over-optimize for cost (quality matters more than pennies)
- ❌ Use LLM when native tools work (search, format, rename)
- ❌ Downgrade tier for critical tasks (security, production bugs)
- ❌ Route without fallback strategy (always have Sonnet default)

**Performance Benchmarks:**

```
Response Time (avg):
  Native Tools: < 0.1s
  Haiku: 1-3s
  Sonnet: 5-10s
  Opus: 15-30s

Cost Efficiency (per 1000 tasks):
  All Opus: $150 (baseline)
  All Sonnet: $30 (80% savings)
  Smart Routing: $7 (95% savings vs Opus, 77% vs Sonnet)

Quality (task success rate):
  Native Tools: 100% (deterministic)
  Haiku: 85% (simple tasks only)
  Sonnet: 95% (most tasks)
  Opus: 98% (all tasks)
```

---

## Examples

### Example 1: Analyzing User Request and Determining Tier

**Scenario:** User requests feature implementation

**User Request:**
```
"Add user authentication to the app"
```

**Routing Analysis:**

```
Step 1: Extract keywords
  Keywords: "add" (+1), "authentication" (+3)
  Base Score: 4 → Sonnet (Tier 2)

Step 2: Analyze context
  Scope: Multiple files (routes, middleware, database)
  Complexity: Security implications (+2)
  Adjusted Score: 6 → Opus (Tier 3)

Step 3: Routing decision
  Tier: 3 (Opus)
  Reason: Security-critical, architectural decision
  Cost: ~$0.015 per subtask

Step 4: Task breakdown with routing
  Main task → Opus:
    "Design authentication architecture"
    Output: Architecture plan with security considerations

  Subtasks → Route separately:
    1. "Implement JWT service" → Sonnet (Tier 2)
    2. "Add password hashing" → Sonnet (Tier 2, security)
    3. "Create login endpoint" → Sonnet (Tier 2)
    4. "Add JSDoc comments" → Haiku (Tier 1)
    5. "Write unit tests" → Haiku (Tier 1)
    6. "Write integration tests" → Sonnet (Tier 2)

Total Cost:
  1 × Opus ($0.015) + 4 × Sonnet ($0.012) + 2 × Haiku ($0.008)
  = $0.035

Without routing (all Opus):
  7 × Opus = $0.105
  Savings: $0.07 (67% reduction)
```

---

### Example 2: Multi-Task Workflow with Mixed Tiers

**Scenario:** Daily development workflow

**Tasks:**

```
Task 1: "Find all TypeScript files in src/"
  Keywords: "find" (+0)
  Routing: Tier 0 (Native Tools)
  Tool: Glob "src/**/*.ts"
  Cost: $0
  Time: < 0.1s

Task 2: "Format all code"
  Keywords: "format" (+0)
  Routing: Tier 0 (Native Tools)
  Tool: Bash "bun run format"
  Cost: $0
  Time: 2s

Task 3: "Add JSDoc to UserService"
  Keywords: "add" (+1), "simple" (implied)
  Routing: Tier 1 (Haiku)
  Model: claude-haiku-4-5
  Cost: $0.004
  Time: 2s

Task 4: "Implement user profile page"
  Keywords: "implement" (+2)
  Context: Multiple files (component, styles, API)
  Routing: Tier 2 (Sonnet)
  Model: claude-sonnet-4-5
  Cost: $0.030
  Time: 8s

Task 5: "Fix pagination bug"
  Keywords: "fix" (+1), "bug" (+2)
  Context: Requires debugging
  Routing: Tier 2 (Sonnet)
  Model: claude-sonnet-4-5
  Cost: $0.025
  Time: 7s

Task 6: "Security audit of auth system"
  Keywords: "security" (+3), "audit" (+3)
  Context: Critical, system-wide
  Routing: Tier 3 (Opus)
  Model: claude-opus-4-5
  Cost: $0.150
  Time: 25s

Daily Summary:
  Total Tasks: 6
  Native Tools: 2 tasks, $0, 2s
  Haiku: 1 task, $0.004, 2s
  Sonnet: 2 tasks, $0.055, 15s
  Opus: 1 task, $0.150, 25s

  Total Cost: $0.209
  Total Time: 44s

Without Routing (all Sonnet):
  6 tasks × $0.030 avg = $0.180 (but slower, less optimized)

Without Routing (all Opus):
  6 tasks × $0.150 avg = $0.900 (4.3× more expensive)
```

---

### Example 3: Cost Comparison Showing Savings from Routing

**Scenario:** Weekly development for small team (3 developers)

**Task Distribution:**

```
Week 1: 150 total tasks

Task Breakdown (with smart routing):
  Tier 0 (Native): 50 tasks (file ops, searches, formatting)
    Cost: $0
    Time: 50 × 1s = 50s

  Tier 1 (Haiku): 45 tasks (comments, docs, simple fixes)
    Cost: 45 × $0.004 = $0.18
    Time: 45 × 2s = 90s

  Tier 2 (Sonnet): 45 tasks (features, refactors, integrations)
    Cost: 45 × $0.030 = $1.35
    Time: 45 × 8s = 360s

  Tier 3 (Opus): 10 tasks (architecture, security, complex bugs)
    Cost: 10 × $0.150 = $1.50
    Time: 10 × 25s = 250s

Total with Routing:
  Cost: $3.03
  Time: 750s (12.5 min)
  Tasks completed: 150

Cost Comparison:

Strategy 1: All Opus (premium everywhere)
  150 tasks × $0.150 = $22.50
  Difference: +$19.47 (7.4× more expensive)

Strategy 2: All Sonnet (standard everywhere)
  150 tasks × $0.030 = $4.50
  Difference: +$1.47 (1.5× more expensive)

Strategy 3: Random 50/50 Haiku/Sonnet (no routing logic)
  75 × $0.004 + 75 × $0.030 = $2.55
  Quality issues: 15 tasks failed (Haiku used for complex)
  Re-work: 15 × $0.030 = $0.45
  Total: $3.00 (similar cost, but failures and delays)

Strategy 4: Smart Routing (this approach)
  Cost: $3.03
  Quality: High (each task matched to appropriate tier)
  Speed: Optimal (fast models for simple, premium for complex)

Annual Savings (3 developers × 52 weeks):
  vs All Opus: 52 × $19.47 = $1,012.44
  vs All Sonnet: 52 × $1.47 = $76.44
  vs Random: 52 × $0.45 (re-work) = $23.40

ROI:
  Save $1,000+ annually vs premium-everywhere approach
  Save $76 annually vs standard-everywhere approach
  Better quality than random routing
```

---

## Troubleshooting

**Problem: Task routed to Haiku, but failed**

Cause: Task more complex than keywords suggested

Solution: Escalate to next tier (Sonnet) and retry

```
❌ Wrong:
  Task fails with Haiku
  → Give up or ask user for help

✅ Correct:
  Task fails with Haiku (Attempt 1)
  → Retry with different prompt (Attempt 2)
  → Still fails? Escalate to Sonnet (Attempt 3)
  → Fixed ✓
```

---

**Problem: Too many tasks routed to Opus (high costs)**

Cause: Overly aggressive routing, not splitting tasks

Solution: Break complex tasks into simpler subtasks

```
❌ Wrong:
  Task: "Implement user authentication" → Opus
  Cost: $0.150

✅ Correct:
  Main task: "Design auth architecture" → Opus ($0.015)
  Subtask 1: "Implement JWT service" → Sonnet ($0.030)
  Subtask 2: "Add JSDoc comments" → Haiku ($0.004)
  Subtask 3: "Write tests" → Haiku ($0.004)
  Total: $0.053 (65% savings)
```

---

**Problem: Routing adds complexity, slows down workflow**

Cause: Over-engineering routing for small projects

Solution: Use simple heuristics for small teams

```
Simple Routing Rule (for small projects):
  - File operations → Native tools
  - Single file < 50 lines → Haiku
  - Everything else → Sonnet
  - User says "complex" → Opus

No need for complex scoring algorithms for < 50 tasks/day.
```

---

**Problem: Can't track costs (no visibility)**

Cause: Missing cost tracking integration

Solution: Add logging to track cost per task

```
After each task:
  Log to performance-tracking.json:
  {
    "task": "Implement profile page",
    "tier": 2,
    "model": "claude-sonnet-4-5",
    "tokens_in": 1200,
    "tokens_out": 2800,
    "cost": 0.0456,
    "duration_seconds": 8,
    "success": true,
    "timestamp": "2026-01-28T10:30:00Z"
  }

Weekly aggregation:
  Generate cost report with breakdown by tier
```

---

## Summary

Task complexity routing optimizes AI workflows by:

- **4-tier system** (Native → Haiku → Sonnet → Opus)
- **Complexity detection** (keyword-based + context-based scoring)
- **Cost optimization** (60-90% savings vs premium-everywhere)
- **Dynamic escalation** (upgrade tier when task fails)
- **Quality maintenance** (match task complexity to model capability)

**Key Takeaways:**

1. **Use native tools first** (free, instant)
2. **Start cheap, escalate as needed** (Haiku → Sonnet → Opus)
3. **Track costs to optimize** (measure, analyze, improve)
4. **Split complex tasks** (route subtasks separately)
5. **Reserve premium for critical** (security, architecture, debugging)

Master routing and you'll deliver faster results at a fraction of the cost.

---

**Inspired By:**
- Cost optimization patterns from production AI workflows
- Multi-tier routing systems (CDN, load balancers, database replication)
- Google's multi-model serving strategy (PaLM vs Gemini routing)
- AWS Lambda tiered pricing (pay for what you use)
- Performance budgets in frontend development (optimize critical path)
