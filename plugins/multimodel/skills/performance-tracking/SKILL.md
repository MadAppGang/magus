---
name: performance-tracking
description: Track agent, skill, and model performance metrics for optimization. Use when measuring agent success rates, tracking model latency, analyzing routing effectiveness, or optimizing cost-per-task. Trigger keywords - "performance", "metrics", "tracking", "success rate", "agent performance", "model latency", "cost tracking", "optimization", "routing metrics".
version: 0.1.0
tags: [orchestration, performance, metrics, tracking, agent-performance, optimization]
keywords: [performance, metrics, tracking, agent, skill, success-rate, latency, cost, optimization, history, routing]
plugin: multimodel
updated: 2026-01-28
---

# Performance Tracking

**Version:** 1.0.0
**Purpose:** Track agent, skill, and model performance metrics for continuous optimization
**Status:** Production Ready

## Overview

Performance tracking transforms workflows from "fire and forget" to **data-driven optimization systems**. By measuring what actually works, you can route tasks more effectively, identify failing patterns early, and reduce costs.

This skill provides battle-tested patterns for:
- **Agent success tracking** (completion rates, confidence scores, task type affinity)
- **Skill effectiveness** (activation counts, success correlation, usage patterns)
- **Model performance** (latency, cost, quality, provider comparison)
- **Routing optimization** (tier distribution, routing accuracy, cost efficiency)
- **Historical analysis** (trend detection, degradation alerts, pattern discovery)

Performance tracking enables **continuous improvement** by providing the data needed to make informed decisions about agent selection, model choice, and workflow routing.

### Why Track Performance

**Optimize Routing:**
- Identify which agents excel at specific task types
- Route complex tasks to high-confidence agents
- Avoid agents with low success rates for critical work

**Identify Failing Agents:**
- Detect agents with <70% success rate
- Alert when agent performance degrades
- Replace or retrain underperforming agents

**Reduce Costs:**
- Find cost-effective model alternatives
- Identify expensive agents with low success rates
- Optimize tier thresholds based on actual performance

**Improve Quality:**
- Track correlation between confidence scores and success
- Identify patterns in successful implementations
- Learn which models produce best results for task types

### What We Track

**Agent Metrics:**
- Total runs, success/failure counts
- Average confidence scores
- Task type distribution
- Last used timestamp
- Individual execution history

**Skill Metrics:**
- Activation counts per skill
- Last activation timestamps
- Success correlation (when skill active, what's success rate?)
- Co-activation patterns

**Model Metrics:**
- Total runs, success/failure counts
- Average latency (response time)
- Total cost (cumulative spend)
- Cost per successful task
- Last used timestamp

**Routing Metrics:**
- Tier distribution (how often each tier selected)
- Routing accuracy (did tier match complexity?)
- Cost efficiency (tier1 vs tier4 cost ratio)
- Decision history with outcomes

### Integration with task-complexity-router

The performance tracker provides critical feedback to the task-complexity-router:

```
Routing Feedback Loop:

1. Router selects tier based on complexity
   → task-complexity-router analyzes task
   → Routes to tier2 (medium complexity)

2. Agent executes task
   → Records: tier=2, agent=ui-developer, result=success

3. Performance tracker updates metrics
   → tier2 usage +1
   → ui-developer success +1
   → Confidence in tier2 routing increases

4. Future routing decisions informed by history
   → Router sees tier2 has 85% success rate
   → Router sees ui-developer excels at UI tasks
   → Router confidently routes similar tasks to tier2
```

---

## Metrics Schema

### JSON Structure (Version 1.0.0)

Store performance metrics in `.claude/agent-performance.json`:

```json
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-01-28T15:30:00Z",
  "agents": {
    "ui-developer": {
      "totalRuns": 42,
      "successCount": 38,
      "failureCount": 4,
      "avgConfidence": 0.85,
      "lastUsed": "2026-01-28T15:30:00Z",
      "taskTypes": {
        "implement-component": 15,
        "fix-styling": 12,
        "refactor-ui": 8,
        "review-code": 7
      },
      "history": [
        {
          "timestamp": "2026-01-28T15:30:00Z",
          "taskType": "implement-component",
          "result": "success",
          "confidence": 0.90,
          "duration": 45000,
          "tier": 2,
          "model": "claude-sonnet-4-5-20250929"
        },
        {
          "timestamp": "2026-01-28T14:20:00Z",
          "taskType": "fix-styling",
          "result": "success",
          "confidence": 0.85,
          "duration": 30000,
          "tier": 1,
          "model": "claude-sonnet-4-5-20250929"
        }
      ]
    },
    "backend-developer": {
      "totalRuns": 28,
      "successCount": 25,
      "failureCount": 3,
      "avgConfidence": 0.88,
      "lastUsed": "2026-01-28T14:00:00Z",
      "taskTypes": {
        "implement-api": 12,
        "fix-bug": 8,
        "database-migration": 5,
        "write-tests": 3
      },
      "history": []
    }
  },
  "skills": {
    "multi-model-validation": {
      "activations": 15,
      "lastActivated": "2026-01-28T15:00:00Z",
      "successCorrelation": 0.92,
      "coActivations": {
        "quality-gates": 12,
        "error-recovery": 8
      }
    },
    "task-complexity-router": {
      "activations": 68,
      "lastActivated": "2026-01-28T15:30:00Z",
      "successCorrelation": 0.85,
      "coActivations": {
        "multi-agent-coordination": 45,
        "hierarchical-coordinator": 30
      }
    }
  },
  "models": {
    "claude-sonnet-4-5-20250929": {
      "totalRuns": 120,
      "successCount": 108,
      "failureCount": 12,
      "avgLatency": 2500,
      "totalCost": 0.45,
      "lastUsed": "2026-01-28T15:30:00Z",
      "taskTypePerformance": {
        "code-review": { "success": 25, "failure": 2 },
        "implementation": { "success": 40, "failure": 5 },
        "testing": { "success": 20, "failure": 3 }
      }
    },
    "x-ai/grok-code-fast-1": {
      "totalRuns": 35,
      "successCount": 30,
      "failureCount": 5,
      "avgLatency": 1800,
      "totalCost": 0.08,
      "lastUsed": "2026-01-28T13:00:00Z",
      "taskTypePerformance": {
        "code-review": { "success": 18, "failure": 2 },
        "implementation": { "success": 12, "failure": 3 }
      }
    }
  },
  "routing": {
    "tierDistribution": {
      "tier1": 45,
      "tier2": 30,
      "tier3": 15,
      "tier4": 8
    },
    "decisions": [
      {
        "timestamp": "2026-01-28T15:30:00Z",
        "taskType": "implement-component",
        "complexity": "medium",
        "selectedTier": 2,
        "agent": "ui-developer",
        "result": "success",
        "cost": 0.003
      },
      {
        "timestamp": "2026-01-28T14:20:00Z",
        "taskType": "fix-styling",
        "complexity": "low",
        "selectedTier": 1,
        "agent": "ui-developer",
        "result": "success",
        "cost": 0.001
      }
    ]
  }
}
```

### Schema Field Definitions

**Agent Metrics:**
- `totalRuns`: Total task executions
- `successCount`: Tasks completed successfully
- `failureCount`: Tasks that failed or required retry
- `avgConfidence`: Rolling average of agent confidence scores (0.0-1.0)
- `lastUsed`: ISO-8601 timestamp of last execution
- `taskTypes`: Distribution of task types (understand agent specialization)
- `history`: Array of recent executions (max 100 entries, FIFO)

**Skill Metrics:**
- `activations`: Total times skill was triggered
- `lastActivated`: ISO-8601 timestamp
- `successCorrelation`: Success rate when this skill is active (0.0-1.0)
- `coActivations`: Skills frequently activated together (detect patterns)

**Model Metrics:**
- `totalRuns`: Total executions
- `successCount`/`failureCount`: Outcome tracking
- `avgLatency`: Average response time in milliseconds
- `totalCost`: Cumulative spend in USD
- `lastUsed`: ISO-8601 timestamp
- `taskTypePerformance`: Success/failure breakdown by task type

**Routing Metrics:**
- `tierDistribution`: Count of tasks routed to each tier
- `decisions`: Array of routing decisions with outcomes (max 100, FIFO)

---

## Tracking Patterns

### Pattern 1: Capturing Agent Performance

**After Agent Completes Task:**

```
Execution Flow:

1. Agent executes task
   Task: ui-developer
   Input: "Implement login form component"
   Result: Success
   Confidence: 0.90
   Duration: 45 seconds
   Tier: 2
   Model: claude-sonnet-4-5-20250929

2. Update agent metrics
   Read: .claude/agent-performance.json
   Update:
     agents["ui-developer"].totalRuns += 1
     agents["ui-developer"].successCount += 1
     agents["ui-developer"].avgConfidence = rolling_avg(0.90)
     agents["ui-developer"].lastUsed = NOW
     agents["ui-developer"].taskTypes["implement-component"] += 1
     agents["ui-developer"].history.push({
       timestamp: NOW,
       taskType: "implement-component",
       result: "success",
       confidence: 0.90,
       duration: 45000,
       tier: 2,
       model: "claude-sonnet-4-5-20250929"
     })
   Trim history if > 100 entries
   Write: .claude/agent-performance.json

3. Calculate derived metrics
   Success rate: successCount / totalRuns = 38/42 = 90.5%
   Avg duration: sum(history.duration) / history.length
   Task affinity: taskTypes sorted by count
```

**After Agent Fails:**

```
Failure Flow:

1. Agent fails task
   Task: backend-developer
   Input: "Implement complex payment flow"
   Result: Failure (error, timeout, or low quality)
   Confidence: 0.65
   Tier: 3

2. Update failure metrics
   agents["backend-developer"].totalRuns += 1
   agents["backend-developer"].failureCount += 1
   agents["backend-developer"].avgConfidence = rolling_avg(0.65)
   agents["backend-developer"].history.push({
     timestamp: NOW,
     taskType: "implement-api",
     result: "failure",
     confidence: 0.65,
     duration: 120000,
     tier: 3,
     error: "Exceeded max iterations"
   })

3. Check for degradation
   If failureCount / totalRuns > 0.30:
     Alert: "backend-developer has >30% failure rate"
     Recommendation: "Review recent failures, retrain, or replace"
```

### Pattern 2: Tracking Model Performance

**After Model Execution:**

```
Execution Flow:

1. Model completes task
   Model: x-ai/grok-code-fast-1
   Task: Code review
   Latency: 1800ms
   Cost: $0.002
   Result: Success

2. Update model metrics
   models["x-ai/grok-code-fast-1"].totalRuns += 1
   models["x-ai/grok-code-fast-1"].successCount += 1
   models["x-ai/grok-code-fast-1"].avgLatency = rolling_avg(1800)
   models["x-ai/grok-code-fast-1"].totalCost += 0.002
   models["x-ai/grok-code-fast-1"].lastUsed = NOW
   models["x-ai/grok-code-fast-1"].taskTypePerformance["code-review"].success += 1

3. Compare model performance
   Claude Sonnet: avgLatency=2500ms, cost=$0.45 (120 runs)
   Grok Fast: avgLatency=1800ms, cost=$0.08 (35 runs)

   Analysis:
   - Grok is 28% faster (1800ms vs 2500ms)
   - Grok is 82% cheaper per run ($0.0023 vs $0.0038)
   - Both have similar success rates (86% vs 90%)

   Recommendation:
   - Use Grok for cost-sensitive tasks
   - Use Claude for critical tasks (higher success rate)
```

### Pattern 3: Recording Skill Activation

**After Skill Activation:**

```
Activation Flow:

1. Skill triggers
   Skill: multi-model-validation
   Context: User requested /review with 3 models

2. Update skill metrics
   skills["multi-model-validation"].activations += 1
   skills["multi-model-validation"].lastActivated = NOW

3. Track co-activation
   Active skills: ["multi-model-validation", "quality-gates"]
   skills["multi-model-validation"].coActivations["quality-gates"] += 1

4. Calculate success correlation
   Tasks with this skill active: 15
   Successful tasks: 14
   Success correlation: 14/15 = 93.3%

5. Pattern detection
   Observation: multi-model-validation + quality-gates = 100% success (12/12)
   Recommendation: Always pair these skills for high-quality reviews
```

### Pattern 4: Routing Decision Tracking

**After Routing Decision:**

```
Routing Flow:

1. Router selects tier
   Task: "Implement user profile page"
   Analysis: Medium complexity (multiple components, state management)
   Selected tier: 2
   Agent: ui-developer
   Model: claude-sonnet-4-5-20250929

2. Record routing decision
   routing.tierDistribution["tier2"] += 1
   routing.decisions.push({
     timestamp: NOW,
     taskType: "implement-component",
     complexity: "medium",
     selectedTier: 2,
     agent: "ui-developer",
     result: "pending"
   })

3. After task completes
   Update decision with result:
   routing.decisions[last].result = "success"
   routing.decisions[last].cost = 0.003

4. Trim decision history if > 100 entries
```

### Pattern 5: Session-Level Aggregation

**End of Session Summary:**

```
Session Summary Flow:

1. Aggregate session metrics
   Session ID: 2026-01-28-session-15
   Duration: 2 hours
   Tasks executed: 15
   Success rate: 14/15 = 93.3%
   Total cost: $0.045
   Models used: Claude (12), Grok (3)

2. Create session snapshot
   File: ai-docs/performance-history/2026-01-28-session-15.json
   Content:
     {
       "sessionId": "2026-01-28-session-15",
       "startTime": "2026-01-28T13:00:00Z",
       "endTime": "2026-01-28T15:00:00Z",
       "duration": 7200000,
       "tasks": 15,
       "successRate": 0.933,
       "totalCost": 0.045,
       "modelUsage": { "claude": 12, "grok": 3 },
       "topAgents": ["ui-developer", "backend-developer"],
       "activeSkills": ["task-complexity-router", "multi-model-validation"]
     }

3. Update rolling metrics
   .claude/agent-performance.json (persistent)
   ai-docs/performance-history/ (snapshots)

4. Cleanup old snapshots
   Keep last 100 session snapshots
   Delete older entries
```

---

## File Location and Management

### Primary Performance File

**Location:** `.claude/agent-performance.json`

**Purpose:** Persistent, project-level performance tracking

**When to Update:**
- After every agent execution
- After every model execution
- After every skill activation
- After every routing decision

**Format:** JSON schema version 1.0.0 (see Metrics Schema section)

**Rotation:** Keep full history, but trim individual history arrays to 100 entries

### Session Snapshots

**Location:** `ai-docs/performance-history/`

**Purpose:** Point-in-time session summaries for historical analysis

**Naming:** `{YYYY-MM-DD}-session-{N}.json`

**Example:**
```
ai-docs/performance-history/
  2026-01-28-session-1.json
  2026-01-28-session-2.json
  2026-01-27-session-1.json
  ...
```

**Retention:** Keep last 100 sessions, delete older

### Integration with Existing Files

**Relationship with ai-docs/llm-performance.json:**

```
Comparison:

llm-performance.json (existing):
  - Model-specific performance
  - Cost tracking per model
  - Response time tracking
  - Used by multi-model-validation

agent-performance.json (new):
  - Agent-level metrics (multi-run aggregation)
  - Skill activation tracking
  - Routing decision history
  - Task type affinity

Integration:
  - agent-performance.json imports model data from llm-performance.json
  - Both files updated in parallel
  - llm-performance.json focuses on single-run details
  - agent-performance.json focuses on aggregate trends
```

**Migration Path:**

```
Step 1: Create .claude/agent-performance.json with schema 1.0.0
Step 2: Import historical data from llm-performance.json
Step 3: Update both files going forward
Step 4: Deprecate llm-performance.json after 6 months (optional)
```

### Data Cleanup and Rotation

**Automatic Cleanup:**

```
Cleanup Rules:

1. Agent history arrays
   Max entries: 100
   Strategy: FIFO (oldest removed first)
   Trigger: After every agent execution

2. Routing decision arrays
   Max entries: 100
   Strategy: FIFO
   Trigger: After every routing decision

3. Session snapshots
   Max files: 100
   Strategy: FIFO (delete oldest session files)
   Trigger: After every session ends

4. Skill co-activation maps
   Max entries per skill: 50
   Strategy: Keep top 50 by count
   Trigger: Weekly cleanup
```

**Manual Cleanup:**

```
When to manually reset:

1. After major workflow changes
   - Agent capabilities changed
   - New skills added
   - Routing logic updated
   → Reset metrics to start fresh

2. After agent retraining
   - Agent prompt updated
   - Agent model changed
   → Reset agent-specific metrics

3. After prolonged period (>6 months)
   - Metrics may be outdated
   → Archive old data, start fresh

How to reset:
  Backup: cp .claude/agent-performance.json .claude/agent-performance-backup-{DATE}.json
  Reset: echo '{"schemaVersion":"1.0.0","lastUpdated":"...","agents":{},...}' > .claude/agent-performance.json
```

---

## Using Metrics for Optimization

### Optimization 1: Identify Underperforming Agents

**Detection:**

```
Analyze agent success rates:

agents["ui-developer"]:
  successCount: 38
  totalRuns: 42
  success rate: 38/42 = 90.5% ✅ GOOD

agents["test-architect"]:
  successCount: 15
  totalRuns: 25
  success rate: 15/25 = 60% ❌ UNDERPERFORMING

Threshold: <70% success rate = underperforming
```

**Action:**

```
For test-architect (60% success):

1. Analyze failure patterns
   Review history entries where result="failure"
   Common failure reasons:
     - "Tests too brittle" (8 occurrences)
     - "Missing test coverage" (5 occurrences)
     - "Test timeout" (2 occurrences)

2. Identify root cause
   Pattern: test-architect struggles with async/timing tests
   Evidence: All timeout failures involved async code

3. Take action
   Option A: Retrain agent
     - Update prompt with async testing best practices
     - Add examples of proper async test patterns
     - Reset metrics after retraining

   Option B: Route differently
     - Route async test tasks to backend-developer (90% success on async)
     - Keep test-architect for synchronous unit tests

   Option C: Replace agent
     - Create new specialized-async-test-architect
     - Deprecate test-architect for async work
```

### Optimization 2: Find Cost-Effective Model Alternatives

**Analysis:**

```
Compare model cost-effectiveness:

Model: claude-sonnet-4-5-20250929
  Total cost: $0.45
  Total runs: 120
  Success count: 108
  Cost per task: $0.0038
  Cost per success: $0.0042
  Success rate: 90%

Model: x-ai/grok-code-fast-1
  Total cost: $0.08
  Total runs: 35
  Success count: 30
  Cost per task: $0.0023
  Cost per success: $0.0027
  Success rate: 86%

Model: google/gemini-2.5-flash
  Total cost: $0.02
  Total runs: 20
  Success count: 16
  Cost per task: $0.0010
  Cost per success: $0.0013
  Success rate: 80%

Cost Efficiency Ranking:
  1. Gemini Flash: $0.0013 per success (80% success rate)
  2. Grok Fast: $0.0027 per success (86% success rate)
  3. Claude Sonnet: $0.0042 per success (90% success rate)

Quality-Cost Tradeoff:
  - Gemini: 69% cheaper than Claude, but 10% lower success rate
  - Grok: 36% cheaper than Claude, but 4% lower success rate
```

**Action:**

```
Optimization strategy:

Tier 1 (Simple tasks):
  Use: Gemini Flash
  Reason: Lowest cost, acceptable success rate for simple work
  Example: "Fix typo in comment", "Format code"

Tier 2 (Medium tasks):
  Use: Grok Fast
  Reason: Good balance of cost and quality
  Example: "Implement CRUD endpoint", "Add validation"

Tier 3 (Complex tasks):
  Use: Claude Sonnet
  Reason: Highest success rate justifies cost
  Example: "Design architecture", "Complex refactoring"

Tier 4 (Critical tasks):
  Use: Claude Sonnet + Multi-model validation
  Reason: Quality > cost for critical work
  Example: "Security review", "Production bug fix"

Expected savings:
  Current: 90% Claude usage × $0.0042 = $0.00378 avg per task
  Optimized: 20% Claude + 50% Grok + 30% Gemini = $0.00257 avg per task
  Savings: 32% cost reduction with minimal quality impact
```

### Optimization 3: Optimize Routing Tier Thresholds

**Analysis:**

```
Review tier distribution:

routing.tierDistribution:
  tier1: 45 tasks (45.9%)
  tier2: 30 tasks (30.6%)
  tier3: 15 tasks (15.3%)
  tier4: 8 tasks (8.2%)

Analyze tier accuracy:

Tier 1 (Simple):
  Tasks: 45
  Success: 42
  Failures: 3
  Success rate: 93.3% ✅
  Verdict: Well-calibrated

Tier 2 (Medium):
  Tasks: 30
  Success: 25
  Failures: 5
  Success rate: 83.3% ⚠️
  Verdict: Slightly low (target 90%)

Tier 3 (Complex):
  Tasks: 15
  Success: 12
  Failures: 3
  Success rate: 80.0% ⚠️
  Verdict: Too low (target 90%)

Tier 4 (Critical):
  Tasks: 8
  Success: 8
  Failures: 0
  Success rate: 100% ✅
  Verdict: Well-calibrated
```

**Action:**

```
Adjust tier thresholds:

Current thresholds (task-complexity-router):
  tier1: complexity score 0-3
  tier2: complexity score 4-6
  tier3: complexity score 7-9
  tier4: complexity score 10+

Problem: tier2 and tier3 have lower success rates
Root cause: Tasks slightly too complex for assigned tier

Optimized thresholds:
  tier1: complexity score 0-2 (narrower range)
  tier2: complexity score 3-5 (shift down)
  tier3: complexity score 6-8 (shift down)
  tier4: complexity score 9+ (broader range)

Rationale:
  - Shift more borderline tasks to higher tiers
  - Accept slightly higher cost for better success rates
  - tier2/tier3 success should improve to 90%+

Expected impact:
  - tier1 usage: 45 → 35 tasks (fewer simple tasks)
  - tier2 usage: 30 → 32 tasks (more medium tasks)
  - tier3 usage: 15 → 18 tasks (more complex tasks)
  - tier4 usage: 8 → 13 tasks (more critical tasks)
  - Overall success rate: 88% → 92%
  - Overall cost: +15% (acceptable tradeoff for quality)
```

### Optimization 4: Detect Model-Task Affinity Patterns

**Analysis:**

```
Analyze task type performance by model:

Task type: code-review

Claude Sonnet:
  Success: 25, Failure: 2
  Success rate: 92.6% ✅

Grok Fast:
  Success: 18, Failure: 2
  Success rate: 90.0% ✅

Gemini Flash:
  Success: 10, Failure: 4
  Success rate: 71.4% ⚠️

→ Pattern: Claude and Grok excel at code review, Gemini struggles

Task type: implementation

Claude Sonnet:
  Success: 40, Failure: 5
  Success rate: 88.9% ✅

Grok Fast:
  Success: 12, Failure: 3
  Success rate: 80.0% ⚠️

Gemini Flash:
  Success: 6, Failure: 1
  Success rate: 85.7% ✅

→ Pattern: Claude best for implementation, Grok/Gemini acceptable

Task type: testing

Claude Sonnet:
  Success: 20, Failure: 3
  Success rate: 87.0% ✅

Grok Fast:
  Success: 0, Failure: 0
  Success rate: N/A

Gemini Flash:
  Success: 0, Failure: 0
  Success rate: N/A

→ Pattern: Only Claude has testing data (others not used for this)
```

**Action:**

```
Task-specific model routing:

code-review tasks:
  tier1: Grok Fast (90% success, low cost)
  tier2: Grok Fast (90% success, low cost)
  tier3: Claude Sonnet (93% success, high quality)
  tier4: Multi-model (Claude + Grok consensus)

implementation tasks:
  tier1: Gemini Flash (86% success, lowest cost)
  tier2: Grok Fast (80% success, medium cost)
  tier3: Claude Sonnet (89% success, highest quality)
  tier4: Claude Sonnet (89% success, proven)

testing tasks:
  tier1-4: Claude Sonnet (only model with proven testing capability)

Expected impact:
  - 25% cost savings on code reviews (use Grok instead of Claude)
  - 10% cost savings on implementation (use Gemini for simple)
  - Maintain quality (route by proven success rates)
```

### Optimization 5: Alert on Performance Degradation

**Detection:**

```
Monitor for degradation:

Week 1 (baseline):
  ui-developer success rate: 90.5%
  Average task duration: 45s

Week 2:
  ui-developer success rate: 88.2% (↓2.3%)
  Average task duration: 48s (↑3s)

Week 3:
  ui-developer success rate: 85.1% (↓5.4% from baseline)
  Average task duration: 52s (↑7s from baseline)

Week 4:
  ui-developer success rate: 78.3% (↓12.2% from baseline) 🚨
  Average task duration: 58s (↑13s from baseline) 🚨

Threshold exceeded:
  ❌ Success rate dropped >10% (78.3% vs 90.5%)
  ❌ Duration increased >20% (58s vs 45s)

→ ALERT: ui-developer performance degraded significantly
```

**Action:**

```
Degradation response:

1. Investigate root cause
   Review recent history:
     - Task complexity increased? (Check taskTypes distribution)
     - Model changed? (Check model field in history)
     - Failures clustered around specific task type?

   Finding: All recent failures on "complex-state-management" tasks
   Root cause: New task type introduced, agent not trained for it

2. Take corrective action
   Option A: Retrain agent
     - Update prompt with state management patterns
     - Add examples of successful state management
     - Reset metrics after retraining

   Option B: Route differently
     - Route state management tasks to specialized agent
     - Keep ui-developer for simpler UI tasks

   Option C: Escalate to human
     - Alert: "ui-developer performance degraded"
     - Request: "Manual review of recent failures needed"

3. Monitor recovery
   Week 5 (after retraining):
     Success rate: 85.0% (recovering)
   Week 6:
     Success rate: 89.2% (near baseline)
   Week 7:
     Success rate: 91.0% (recovered ✅)
```

---

## Integration with Orchestration Plugin

### Integration 1: multi-model-validation

**How multi-model-validation records model performance:**

```
Multi-Model Review Flow:

1. Execute parallel review
   Models: [claude-sonnet, grok-fast, gemini-flash]
   Task: Code review of auth.ts

2. Collect model responses
   Each model returns:
     - Review findings
     - Confidence score
     - Latency
     - Cost

3. Record individual model performance
   For each model:
     models[modelId].totalRuns += 1
     models[modelId].avgLatency = rolling_avg(latency)
     models[modelId].totalCost += cost

4. Determine success/failure
   If review found critical issues → success (doing its job)
   If review crashed/errored → failure

5. Update success counts
   models[modelId].successCount += 1  (or failureCount)
   models[modelId].taskTypePerformance["code-review"].success += 1

6. Consolidate findings
   Generate consensus report
   Track which models agreed (co-occurrence patterns)

7. User feedback (optional)
   User rates review quality: "Helpful" | "Not helpful"
   Update successCorrelation for multi-model-validation skill
```

### Integration 2: task-complexity-router

**How task-complexity-router reads performance data:**

```
Routing Decision Flow:

1. Analyze task complexity
   Input: "Implement user authentication with OAuth"
   Analysis: Complex (multiple components, external API, security)
   Base tier: 3

2. Read performance history
   Load: .claude/agent-performance.json
   Check: routing.tierDistribution

3. Adjust tier based on history
   tier3 historical success rate: 80% (below 90% target)
   tier4 historical success rate: 100%

   Decision: Bump to tier4 for higher success probability

4. Select agent based on task type affinity
   Task type: "implement-api"
   Candidates: backend-developer, full-stack-developer

   Check affinity:
     backend-developer.taskTypes["implement-api"]: 12 (high affinity)
     full-stack-developer.taskTypes["implement-api"]: 3 (low affinity)

   Decision: Select backend-developer (proven track record)

5. Select model based on tier + task type
   tier4 + implement-api:
     models[claude].taskTypePerformance["implementation"]: 89% success
     models[grok].taskTypePerformance["implementation"]: 80% success

   Decision: Select Claude (higher success rate for tier4)

6. Record routing decision
   routing.decisions.push({
     timestamp: NOW,
     taskType: "implement-api",
     complexity: "complex",
     selectedTier: 4,
     agent: "backend-developer",
     model: "claude-sonnet-4-5-20250929",
     result: "pending"
   })

7. After execution, update result
   routing.decisions[last].result = "success"
   routing.decisions[last].cost = 0.005
```

### Integration 3: hierarchical-coordinator

**How hierarchical-coordinator tracks phase success:**

```
Phase Execution Tracking:

1. Execute workflow phases
   Phase 1: Planning (architect agent)
   Phase 2: Implementation (developer agent)
   Phase 3: Testing (tester agent)
   Phase 4: Review (reviewer agent)

2. Track phase-level metrics
   Create phase-specific tracking:

   agents["architect"].phasePerformance = {
     "planning": { success: 15, failure: 2 },
     "architecture": { success: 8, failure: 1 }
   }

   agents["developer"].phasePerformance = {
     "implementation": { success: 25, failure: 5 },
     "refactoring": { success: 10, failure: 2 }
   }

3. Detect phase-specific issues
   Analysis: developer has 20% failure rate on implementation phase
   But: developer has 83% success rate overall

   Insight: Failures concentrated in specific phase

4. Optimize phase assignment
   Current: developer handles all implementation
   Optimized: Split by complexity
     - Simple implementation → junior-developer (cheaper)
     - Complex implementation → senior-developer (higher success)

5. Track coordinator effectiveness
   skills["hierarchical-coordinator"].activations += 1
   skills["hierarchical-coordinator"].successCorrelation = 0.92

   Insight: Workflows using coordinator have 92% success (vs 80% without)
```

### Integration 4: quality-gates

**How quality-gates uses performance thresholds:**

```
Quality Gate Decision:

1. Agent completes task
   Agent: ui-developer
   Task: "Implement dashboard component"
   Confidence: 0.75

2. Check agent performance history
   Load: agents["ui-developer"]
   Historical avg confidence: 0.85
   Current confidence: 0.75 (below average 🚨)

3. Apply quality gate
   Threshold: If confidence < avg - 0.10, trigger validation

   Decision: 0.75 < 0.75 (borderline)
   Action: Trigger designer validation (extra quality check)

4. Designer validates
   Result: Found 3 minor issues
   Verdict: Quality gate prevented low-quality work from proceeding

5. Update metrics
   Without gate: ui-developer would have 1 more failure
   With gate: Issues caught early, fixed before user sees

   skills["quality-gates"].successCorrelation += 1
   (Success correlation increases when gate prevents failures)

6. Continuous improvement
   Pattern: Low-confidence tasks benefit from extra validation
   Threshold: Automatically adjust based on correlation data
   Future: If confidence < 0.80, always trigger validation
```

---

## Best Practices

### Do

- ✅ **Track all agent executions** (success and failure provide learning signal)
- ✅ **Record model latency and cost** (optimize for cost-effectiveness)
- ✅ **Maintain execution history** (detect patterns and trends)
- ✅ **Set success rate thresholds** (<70% = investigate, <50% = replace)
- ✅ **Alert on performance degradation** (>10% drop from baseline)
- ✅ **Use task type affinity** (route tasks to agents with proven success)
- ✅ **Compare model cost-effectiveness** (cost per success, not just cost per task)
- ✅ **Track skill co-activation** (identify successful skill combinations)
- ✅ **Rotate history data** (keep last 100 entries, prevent unbounded growth)
- ✅ **Create session snapshots** (point-in-time analysis)
- ✅ **Integrate with routing** (feed performance data back to router)

### Don't

- ❌ **Track only successes** (failures provide valuable learning signal)
- ❌ **Ignore degradation** (small drops compound into big problems)
- ❌ **Use stale data** (>6 months old metrics may not reflect current state)
- ❌ **Over-optimize on cost alone** (balance cost and quality)
- ❌ **Forget to update metrics** (incomplete data leads to poor decisions)
- ❌ **Store unbounded history** (trim arrays to prevent file bloat)
- ❌ **Mix session metrics** (isolate session data for cleaner analysis)
- ❌ **Ignore task type affinity** (agents specialize, use it)
- ❌ **Skip validation after major changes** (reset metrics when workflows change)

### Privacy Considerations

**What to Track:**
- Aggregate metrics (counts, averages, distributions)
- Task types (generic categories like "implement-component")
- Success/failure outcomes
- Model performance data
- Timing and cost data

**What NOT to Track:**
- User-specific data (usernames, emails)
- Sensitive code snippets
- API keys or credentials
- Personal information
- Business logic details

**Data Retention:**
- Keep aggregate metrics indefinitely (no PII)
- Rotate detailed history after 100 entries
- Delete session snapshots after 100 sessions
- Archive old metrics before major resets

### When to Reset Metrics

**Situations Requiring Reset:**

1. **Agent capabilities changed**
   - Prompt updated significantly
   - Agent model changed
   - Agent skills added/removed
   → Reset agent-specific metrics

2. **Workflow architecture changed**
   - New routing logic
   - New tier definitions
   - New skill combinations
   → Reset routing and skill metrics

3. **Model pricing changed**
   - Cost per token updated
   - New pricing tier
   → Reset cost calculations (keep counts)

4. **After prolonged period (>6 months)**
   - Metrics may be outdated
   - Workflow patterns changed
   → Archive and reset all metrics

**How to Reset:**

```bash
# Backup current metrics
cp .claude/agent-performance.json .claude/agent-performance-backup-$(date +%Y%m%d).json

# Reset to empty state
cat > .claude/agent-performance.json << 'EOF'
{
  "schemaVersion": "1.0.0",
  "lastUpdated": "2026-01-28T16:00:00Z",
  "agents": {},
  "skills": {},
  "models": {},
  "routing": {
    "tierDistribution": {},
    "decisions": []
  }
}
EOF

# Archive old session snapshots
mkdir -p ai-docs/performance-history/archive-$(date +%Y%m%d)
mv ai-docs/performance-history/*.json ai-docs/performance-history/archive-$(date +%Y%m%d)/
```

### Metric Hygiene

**Regular Maintenance:**

```
Weekly:
  - Review top agents (ensure success rates >70%)
  - Check model cost trends (identify cost spikes)
  - Trim co-activation maps (keep top 50 per skill)

Monthly:
  - Analyze task type affinity changes
  - Compare model cost-effectiveness
  - Review tier distribution accuracy
  - Archive old session snapshots (keep last 100)

Quarterly:
  - Deep analysis of performance trends
  - Optimize routing thresholds
  - Identify underperforming patterns
  - Consider agent retraining or replacement

Annually:
  - Full metrics review and reset (if needed)
  - Archive all historical data
  - Update baseline success rates
  - Document lessons learned
```

---

## Examples

### Example 1: Tracking a Multi-Model Review Session

**Scenario:** User requests `/review` with 3 models (Claude, Grok, Gemini)

**Execution:**

```
Step 1: Initialize session
  Session ID: 2026-01-28-session-15
  Start time: 15:00:00Z

Step 2: Execute multi-model review
  Models: [claude-sonnet, grok-fast, gemini-flash]
  Task: Code review of auth/login.ts (450 lines)

Step 3: Track individual model executions

  Model: claude-sonnet-4-5-20250929
    Start: 15:00:05Z
    End: 15:00:08Z
    Latency: 3000ms
    Cost: $0.003
    Result: Found 5 issues (2 CRITICAL, 3 HIGH)
    Outcome: Success

  Update metrics:
    models["claude-sonnet-4-5-20250929"].totalRuns = 121
    models["claude-sonnet-4-5-20250929"].successCount = 109
    models["claude-sonnet-4-5-20250929"].avgLatency = 2520ms
    models["claude-sonnet-4-5-20250929"].totalCost = $0.453
    models["claude-sonnet-4-5-20250929"].taskTypePerformance["code-review"].success = 26

  Model: x-ai/grok-code-fast-1
    Start: 15:00:05Z
    End: 15:00:07Z
    Latency: 2000ms
    Cost: $0.002
    Result: Found 4 issues (2 CRITICAL, 2 HIGH)
    Outcome: Success

  Update metrics:
    models["x-ai/grok-code-fast-1"].totalRuns = 36
    models["x-ai/grok-code-fast-1"].successCount = 31
    models["x-ai/grok-code-fast-1"].avgLatency = 1820ms
    models["x-ai/grok-code-fast-1"].totalCost = $0.082
    models["x-ai/grok-code-fast-1"].taskTypePerformance["code-review"].success = 19

  Model: google/gemini-2.5-flash
    Start: 15:00:05Z
    End: 15:00:06Z
    Latency: 1500ms
    Cost: $0.001
    Result: Found 3 issues (1 CRITICAL, 2 MEDIUM)
    Outcome: Success

  Update metrics:
    models["google/gemini-2.5-flash"].totalRuns = 21
    models["google/gemini-2.5-flash"].successCount = 17
    models["google/gemini-2.5-flash"].avgLatency = 1480ms
    models["google/gemini-2.5-flash"].totalCost = $0.021
    models["google/gemini-2.5-flash"].taskTypePerformance["code-review"].success = 11

Step 4: Track skill activation
  skills["multi-model-validation"].activations = 16
  skills["multi-model-validation"].lastActivated = 15:00:08Z
  skills["multi-model-validation"].coActivations["quality-gates"] = 13

Step 5: Consolidate findings
  Consensus issues (all 3 models agreed):
    - CRITICAL: SQL injection vulnerability (UNANIMOUS)
    - CRITICAL: Missing authentication check (UNANIMOUS)

  Majority issues (2/3 models agreed):
    - HIGH: Insufficient input validation (Claude, Grok)
    - HIGH: Missing error handling (Claude, Grok)

  Divergent issues (1/3 models):
    - MEDIUM: Code duplication (Gemini only)

Step 6: Record session summary
  Session complete:
    Duration: 8 seconds
    Models used: 3
    Total cost: $0.006
    Issues found: 5 (2 unanimous, 2 majority, 1 divergent)
    Result: Success

  Create snapshot:
    ai-docs/performance-history/2026-01-28-session-15.json

Step 7: Update aggregate metrics
  Overall session success rate: 3/3 models successful = 100%
  Cost efficiency: $0.002 per model = good value
```

**Insights from Tracking:**

```
Performance comparison:
  Fastest: Gemini (1500ms) - 50% faster than Claude
  Most thorough: Claude (5 issues) - Found 1 extra issue
  Best value: Gemini ($0.001, 3 issues) - Lowest cost, good coverage

Cost analysis:
  Total: $0.006 for 3-model review
  vs Single Claude: $0.003 (double cost, but 2x validation)
  ROI: Found 2 CRITICAL issues all models agreed on = high confidence

Consensus validation:
  UNANIMOUS issues (100% confidence) → Fix immediately
  MAJORITY issues (67% confidence) → Fix before merge
  DIVERGENT issues (33% confidence) → Low priority (possible false positive)

Recommendation:
  Multi-model validation worth the cost for critical code (auth, payments, security)
  Single-model sufficient for non-critical code (UI components, docs)
```

---

### Example 2: Identifying Model Performance Differences

**Scenario:** After 100 tasks, compare model performance for optimization

**Execution:**

```
Step 1: Load performance data
  Read: .claude/agent-performance.json

Step 2: Extract model metrics

  Claude Sonnet:
    Total runs: 120
    Success: 108, Failure: 12
    Success rate: 90.0%
    Avg latency: 2500ms
    Total cost: $0.45
    Cost per task: $0.00375
    Cost per success: $0.00417

  Grok Fast:
    Total runs: 35
    Success: 30, Failure: 5
    Success rate: 85.7%
    Avg latency: 1800ms
    Total cost: $0.08
    Cost per task: $0.00229
    Cost per success: $0.00267

  Gemini Flash:
    Total runs: 20
    Success: 16, Failure: 4
    Success rate: 80.0%
    Avg latency: 1500ms
    Total cost: $0.02
    Cost per task: $0.00100
    Cost per success: $0.00125

Step 3: Analyze task type performance

  Code Review:
    Claude: 25 success, 2 failure = 92.6%
    Grok: 18 success, 2 failure = 90.0%
    Gemini: 10 success, 4 failure = 71.4%

    Winner: Claude (highest quality)
    Best value: Grok (90% at lower cost)

  Implementation:
    Claude: 40 success, 5 failure = 88.9%
    Grok: 12 success, 3 failure = 80.0%
    Gemini: 6 success, 1 failure = 85.7%

    Winner: Claude (highest quality)
    Surprising: Gemini performs well here (86% success)

  Testing:
    Claude: 20 success, 3 failure = 87.0%
    Grok: No data
    Gemini: No data

    Winner: Claude (only option)
    Action: Try Grok/Gemini for testing tasks to gather data

Step 4: Calculate cost-effectiveness by task type

  Code Review Cost-Effectiveness:
    Claude: $0.00417 per success, 92.6% quality
    Grok: $0.00267 per success, 90.0% quality (36% cheaper, -2.6% quality)
    Gemini: $0.00125 per success, 71.4% quality (70% cheaper, -21.2% quality)

    Recommendation: Use Grok for cost-effective reviews (minimal quality loss)

  Implementation Cost-Effectiveness:
    Claude: $0.00417 per success, 88.9% quality
    Grok: $0.00267 per success, 80.0% quality (36% cheaper, -8.9% quality)
    Gemini: $0.00125 per success, 85.7% quality (70% cheaper, -3.2% quality)

    Recommendation: Use Gemini for simple implementation (best value)

Step 5: Generate optimization plan

  Current usage (120 total tasks):
    Claude: 100 tasks (83%)
    Grok: 15 tasks (13%)
    Gemini: 5 tasks (4%)

  Optimized usage (maintain quality >85%):
    tier1 (Simple): Gemini (30% of tasks)
    tier2 (Medium): Grok (40% of tasks)
    tier3 (Complex): Claude (25% of tasks)
    tier4 (Critical): Claude + Multi-model (5% of tasks)

  Expected impact:
    Current avg cost: $0.00375 per task
    Optimized avg cost: $0.00240 per task
    Savings: 36% cost reduction

    Current avg success: 88.5%
    Optimized avg success: 86.2% (projected)
    Quality impact: -2.3% (acceptable tradeoff)

Step 6: Implement gradual rollout

  Week 1: Route 20% of tier1 tasks to Gemini
    Monitor: Success rate, cost savings
    Target: >80% success rate

  Week 2: Route 40% of tier2 tasks to Grok
    Monitor: Success rate, cost savings
    Target: >85% success rate

  Week 3: Evaluate results
    If successful: Increase percentages
    If unsuccessful: Rollback and investigate

Step 7: Track optimization results

  After 2 weeks:
    Gemini tier1 success: 82% ✅ (above 80% target)
    Grok tier2 success: 87% ✅ (above 85% target)
    Cost savings: 28% ✅ (approaching 36% target)

  Decision: Continue rollout
  Next: Route 50% tier1 to Gemini, 60% tier2 to Grok
```

**Insights from Analysis:**

```
Key findings:
  1. Grok is best value for code reviews (90% quality at 36% lower cost)
  2. Gemini surprisingly good for implementation (86% vs 89% Claude)
  3. Claude still best for critical work (92% code review success)
  4. Latency varies significantly (Gemini 40% faster than Claude)

Optimization strategy:
  - Use Gemini for simple, latency-sensitive tasks
  - Use Grok for medium-complexity, cost-sensitive tasks
  - Use Claude for critical, quality-sensitive tasks
  - Use multi-model for maximum confidence (despite cost)

Expected ROI:
  - 36% cost reduction (from $0.00375 to $0.00240 per task)
  - 2.3% quality tradeoff (from 88.5% to 86.2% success)
  - Worth it: Save $135 per 100,000 tasks with minimal quality impact
```

---

### Example 3: Optimizing Routing Based on Accumulated Data

**Scenario:** After 100 routing decisions, optimize tier thresholds

**Execution:**

```
Step 1: Load routing data
  Read: .claude/agent-performance.json
  Focus: routing.tierDistribution, routing.decisions

Step 2: Analyze tier distribution

  Current distribution:
    tier1: 45 tasks (45.9%)
    tier2: 30 tasks (30.6%)
    tier3: 15 tasks (15.3%)
    tier4: 8 tasks (8.2%)

  Skew analysis:
    Heavy on tier1 (46%) - Router prefers simple classification
    Light on tier4 (8%) - Router rarely escalates

Step 3: Calculate tier success rates

  tier1 (Simple tasks):
    Total: 45
    Success: 42, Failure: 3
    Success rate: 93.3% ✅
    Avg cost: $0.001
    Avg duration: 25s

  tier2 (Medium tasks):
    Total: 30
    Success: 25, Failure: 5
    Success rate: 83.3% ⚠️ (target: 90%)
    Avg cost: $0.002
    Avg duration: 45s

  tier3 (Complex tasks):
    Total: 15
    Success: 12, Failure: 3
    Success rate: 80.0% ⚠️ (target: 90%)
    Avg cost: $0.004
    Avg duration: 90s

  tier4 (Critical tasks):
    Total: 8
    Success: 8, Failure: 0
    Success rate: 100% ✅
    Avg cost: $0.008
    Avg duration: 120s

Step 4: Analyze tier2/tier3 failures

  tier2 failures (5 tasks):
    1. "Implement complex state management" (complexity: 6)
       - Should have been tier3 (underestimated)
    2. "Add authentication to API" (complexity: 6)
       - Should have been tier3 (security = critical)
    3. "Refactor component with hooks" (complexity: 5)
       - Should have been tier2 (correctly routed, agent issue)
    4. "Implement drag-and-drop" (complexity: 6)
       - Should have been tier3 (complex interaction)
    5. "Add real-time updates" (complexity: 6)
       - Should have been tier3 (WebSocket complexity)

  Pattern: 4/5 failures were borderline tier2/tier3 (complexity 6)
  Root cause: tier2 upper threshold too high (should be 5, not 6)

  tier3 failures (3 tasks):
    1. "Design microservices architecture" (complexity: 9)
       - Should have been tier4 (architecture = critical)
    2. "Implement payment processing" (complexity: 9)
       - Should have been tier4 (money = critical)
    3. "Refactor authentication system" (complexity: 8)
       - Correctly routed, agent struggled with complexity

  Pattern: 2/3 failures should have been tier4 (complexity 9)
  Root cause: tier3 upper threshold too high (should be 8, not 9)

Step 5: Propose threshold adjustments

  Current thresholds:
    tier1: complexity 0-3
    tier2: complexity 4-6
    tier3: complexity 7-9
    tier4: complexity 10+

  Problem: Borderline tasks (6, 9) cause failures

  Optimized thresholds:
    tier1: complexity 0-2 (narrower, more confident)
    tier2: complexity 3-5 (shift down, avoid borderline 6)
    tier3: complexity 6-8 (shift down, avoid borderline 9)
    tier4: complexity 9+ (broader, include borderline cases)

  Rationale:
    - Move borderline complexity 6 from tier2 → tier3
    - Move borderline complexity 9 from tier3 → tier4
    - Accept 15% higher cost for 10% better success rate

Step 6: Simulate new distribution

  Reclassify historical tasks with new thresholds:

  tier1 (0-2): 35 tasks (35%)
    Success rate: 34/35 = 97.1% ↑ (was 93.3%)

  tier2 (3-5): 32 tasks (32%)
    Success rate: 30/32 = 93.8% ↑ (was 83.3%)

  tier3 (6-8): 18 tasks (18%)
    Success rate: 17/18 = 94.4% ↑ (was 80.0%)

  tier4 (9+): 13 tasks (13%)
    Success rate: 13/13 = 100% ✓ (was 100%)

  Overall success rate: 94/98 = 95.9% ↑ (was 87.8%)

Step 7: Calculate cost impact

  Current avg cost: $0.00240 per task
  Optimized avg cost: $0.00276 per task (+15%)

  Cost breakdown:
    tier1 (35%): $0.001 × 0.35 = $0.00035
    tier2 (32%): $0.002 × 0.32 = $0.00064
    tier3 (18%): $0.004 × 0.18 = $0.00072
    tier4 (13%): $0.008 × 0.13 = $0.00104
    Total: $0.00275 (rounded $0.00276)

  ROI calculation:
    Cost increase: +$0.00036 per task (+15%)
    Success increase: +8.1% (from 87.8% to 95.9%)
    Failure reduction: 12 → 4 failures (67% reduction)

  Value: Preventing 8 failures per 100 tasks worth the 15% cost increase

Step 8: Implement new thresholds

  Update task-complexity-router skill:
    OLD:
      if (complexity <= 3) return "tier1";
      if (complexity <= 6) return "tier2";
      if (complexity <= 9) return "tier3";
      return "tier4";

    NEW:
      if (complexity <= 2) return "tier1";
      if (complexity <= 5) return "tier2";
      if (complexity <= 8) return "tier3";
      return "tier4";

  Document change:
    Reason: Performance data showed borderline tasks caused failures
    Expected: 8% success rate improvement, 15% cost increase
    Monitoring: Track next 100 tasks to validate improvement

Step 9: Monitor post-optimization

  After 50 tasks with new thresholds:
    tier1: 18 tasks, 18 success = 100% ✅
    tier2: 16 tasks, 15 success = 93.8% ✅
    tier3: 10 tasks, 9 success = 90.0% ✅
    tier4: 6 tasks, 6 success = 100% ✅

  Overall: 48/50 = 96.0% success ✅ (matches projection)
  Avg cost: $0.00280 ✅ (matches projection)

  Verdict: Optimization successful, keep new thresholds
```

**Insights from Optimization:**

```
Key findings:
  1. Borderline complexity scores (6, 9) caused most failures
  2. Router was too aggressive in keeping tasks at lower tiers
  3. Small threshold adjustments (6→5, 9→8) had big impact

Optimization results:
  - Success rate: 87.8% → 96.0% (+8.2%)
  - Failure rate: 12.2% → 4.0% (-67%)
  - Cost per task: $0.00240 → $0.00280 (+15%)
  - ROI: Strong (quality improvement worth cost increase)

Lessons learned:
  - Track tier success rates, not just overall success
  - Borderline cases benefit from tier escalation
  - Performance data reveals routing blind spots
  - Continuous monitoring enables iterative improvement

Next steps:
  - Continue monitoring for 100 more tasks
  - Consider dynamic thresholds (adjust based on live data)
  - Explore agent-specific routing (some agents handle complexity better)
```

---

## Troubleshooting

**Problem: Agent performance.json file growing too large**

**Cause:** History arrays not being trimmed

**Solution:** Implement automatic trimming after each update

```javascript
function updateAgentMetrics(agentId, execution) {
  const agent = metrics.agents[agentId];

  // Update aggregates
  agent.totalRuns += 1;
  agent.successCount += execution.result === "success" ? 1 : 0;

  // Add to history
  agent.history.push(execution);

  // Trim to max 100 entries (FIFO)
  if (agent.history.length > 100) {
    agent.history = agent.history.slice(-100);
  }
}
```

---

**Problem: Metrics don't reflect recent changes**

**Cause:** Stale data from old workflows

**Solution:** Reset metrics after major changes

```bash
# Backup current metrics
cp .claude/agent-performance.json .claude/agent-performance-backup-$(date +%Y%m%d).json

# Reset relevant sections (keep models, reset agents)
# Edit .claude/agent-performance.json manually or use script
```

---

**Problem: Success rate calculations seem wrong**

**Cause:** Inconsistent result values ("success", "SUCCESS", "completed", etc.)

**Solution:** Normalize result values

```javascript
function normalizeResult(result) {
  const successValues = ["success", "SUCCESS", "completed", "PASS"];
  const failureValues = ["failure", "FAILURE", "error", "ERROR", "FAIL"];

  if (successValues.includes(result)) return "success";
  if (failureValues.includes(result)) return "failure";
  return "unknown";
}

// Use normalized values in metrics
const normalizedResult = normalizeResult(execution.result);
agent.successCount += normalizedResult === "success" ? 1 : 0;
agent.failureCount += normalizedResult === "failure" ? 1 : 0;
```

---

## Summary

Performance tracking enables **data-driven orchestration optimization** through:

- **Agent success tracking** (identify high-performers and underperformers)
- **Model performance comparison** (find cost-effective alternatives)
- **Skill effectiveness analysis** (discover successful patterns)
- **Routing optimization** (adjust tier thresholds based on actual results)
- **Historical trend detection** (alert on degradation, celebrate improvements)

Key metrics to monitor:
- Agent success rate (target >70%, alert if <60%)
- Model cost-effectiveness (cost per success, not just cost per task)
- Routing tier accuracy (target >90% success per tier)
- Skill activation correlation (identify high-value skills)

Master performance tracking and your orchestration workflows will continuously improve, delivering better results at lower costs.

---

**Inspired By:**
- `/review` command (multi-model performance tracking)
- `/dev` command (agent success rate monitoring)
- task-complexity-router skill (routing feedback loops)
- Production workflows (cost optimization, quality tracking)
