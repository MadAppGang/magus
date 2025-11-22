# Orchestration Plugin

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-production--ready-brightgreen)

**Shared multi-agent coordination and workflow orchestration patterns for complex Claude Code workflows.**

## Overview

The **orchestration plugin** provides proven patterns for:
- **Parallel multi-model execution** (3-5x speedup via Claudish proxy with Grok, Gemini, GPT-5)
- **Multi-agent coordination** (sequential vs parallel execution strategies)
- **Quality gates and iteration loops** (approval gates, severity classification, consensus analysis, test-driven development)
- **Error recovery** (timeout, model failure, partial success, cancellation handling)
- **TodoWrite integration** (phase tracking in complex workflows)

This plugin extracts sophisticated orchestration knowledge from existing plugins (primarily frontend) into reusable, shareable skills that any plugin can leverage.

## Key Innovation

Transforms hardcoded orchestration knowledge from command prompts into **modular, context-efficient skills** that can be loaded on-demand. Instead of duplicating patterns across multiple commands, plugins can reference these battle-tested skills for instant orchestration expertise.

## Quick Start (5 Minutes)

Get started with orchestration patterns in 5 minutes:

### 1. Install
```bash
/plugin install orchestration@mag-claude-plugins
```

### 2. Choose Your Use Case

**Multi-Model Review?**
```yaml
skills: orchestration:multi-model-validation
```

**Multi-Agent Workflow?**
```yaml
skills: orchestration:multi-agent-coordination
```

**Test-Driven Development?**
```yaml
skills: orchestration:quality-gates, orchestration:todowrite-orchestration
```

**Complex Multi-Phase Workflow?**
```yaml
skills: orchestration:complete  # All 5 skills
```

Or use skill bundles:
```yaml
skills: orchestration:testing    # quality-gates + error-recovery + todowrite
```

### 3. Run Your First Workflow

See `examples/parallel-review-example.md` for a complete working example of multi-model validation.

### 4. Learn More

Read skill documentation in `skills/` directory for detailed patterns, examples, and troubleshooting.

## Skills

### 1. Multi-Agent Coordination

**File:** `skills/multi-agent-coordination/SKILL.md`

Coordinate multiple agents in parallel or sequential workflows. Use when running agents simultaneously, delegating to sub-agents, switching between specialized agents, or managing agent selection.

**Trigger Keywords:** "parallel agents", "sequential workflow", "delegate", "multi-agent", "sub-agent", "agent switching", "task decomposition"

**Core Patterns:**
- Sequential vs Parallel Execution (4-Message Pattern for true parallelism)
- Agent Selection by Task Type (API/UI/Testing/Review)
- Sub-Agent Delegation (file-based instructions, brief summaries)
- Context Window Management (when to delegate vs execute inline)

**Extracted From:** `/implement`, `/validate-ui`, `/review` commands

---

### 2. Multi-Model Validation

**File:** `skills/multi-model-validation/SKILL.md`

Run multiple AI models in parallel for 3-5x speedup. Use when validating with Grok, Gemini, GPT-5, DeepSeek, or Claudish proxy for code review, consensus analysis, or multi-expert validation.

**Trigger Keywords:** "grok", "gemini", "gpt-5", "deepseek", "claudish", "multiple models", "parallel review", "external AI", "consensus", "multi-model"

**Core Patterns:**
- The 4-Message Pattern (MANDATORY for parallel execution)
- Parallel Execution Architecture (single message, multiple Tasks)
- Proxy Mode Implementation (blocking execution, file outputs)
- Cost Estimation and Transparency (input/output token separation)
- Auto-Consolidation Logic (triggered when N ≥ 2 reviews complete)
- Consensus Analysis (unanimous → strong → majority → divergent)

**Extracted From:** `/review` command, `CLAUDE.md` Parallel Multi-Model Execution Protocol

---

### 3. Quality Gates

**File:** `skills/quality-gates/SKILL.md`

Implement quality gates, user approval, iteration loops, and test-driven development. Use when validating with users, implementing feedback loops, classifying issue severity, running test-driven loops, or building multi-iteration workflows.

**Trigger Keywords:** "approval", "user validation", "iteration", "feedback loop", "severity", "test-driven", "TDD", "quality gate", "consensus"

**Core Patterns:**
- User Approval Gates (cost, quality, final validation)
- Iteration Loop Patterns (max 10 iterations, clear exit criteria)
- Issue Severity Classification (CRITICAL, HIGH, MEDIUM, LOW)
- Multi-Reviewer Consensus (unanimous vs majority agreement)
- Feedback Loop Implementation (user reports → fix → re-validate)
- Test-Driven Development Loop (write tests → run → analyze failures → fix → repeat)

**Extracted From:** `/review`, `/validate-ui`, `/implement` commands

---

### 4. TodoWrite Orchestration

**File:** `skills/todowrite-orchestration/SKILL.md`

Track progress in multi-phase workflows with TodoWrite. Use when orchestrating 5+ phase commands, managing iteration loops, tracking parallel tasks, or providing real-time progress visibility.

**Trigger Keywords:** "phase tracking", "progress", "workflow", "multi-step", "multi-phase", "todo", "tracking", "status"

**Core Patterns:**
- Phase Initialization (create task list before starting)
- Task Granularity Guidelines (8-15 tasks for typical workflows)
- Status Transitions (pending → in_progress → completed)
- Real-Time Progress Tracking (mark completed immediately)
- Iteration Loop Tracking (create task per iteration)
- Parallel Task Tracking (update as each agent completes)

**Extracted From:** `/review`, `/implement`, `/validate-ui` commands

---

### 5. Error Recovery

**File:** `skills/error-recovery/SKILL.md`

Handle errors, timeouts, and failures in multi-agent workflows. Use when dealing with external model timeouts, API failures, partial success, user cancellation, or graceful degradation.

**Trigger Keywords:** "error", "failure", "timeout", "retry", "fallback", "cancelled", "graceful degradation", "recovery", "partial success"

**Core Patterns:**
- Timeout Handling (30s threshold, retry with 60s, or skip)
- API Failure Recovery (401, 500, network errors - retry or fallback)
- Partial Success Strategies (N ≥ 2 threshold, adapt to failures)
- User Cancellation Handling (graceful Ctrl+C, save partial results)
- Missing Tools (claudish not installed, fallback to embedded)
- Out of Credits (402 error, fallback to free models)
- Retry Strategies (exponential backoff, max 3 retries)

**Extracted From:** `/review` error handling, production Claudish failures

---

## Skill Bundles

Pre-defined skill combinations for common use cases:

- **core** - `multi-agent-coordination` + `quality-gates`
- **advanced** - `multi-model-validation` + `error-recovery`
- **testing** - `quality-gates` + `error-recovery`
- **complete** - All 5 skills

## Installation

### Option 1: Dependency Declaration (Recommended)

Plugins declare orchestration as a dependency:

```json
// plugins/your-plugin/plugin.json
{
  "name": "your-plugin",
  "version": "1.0.0",
  "dependencies": {
    "orchestration@mag-claude-plugins": "^0.1.0"
  }
}
```

**How It Works:**
1. User installs your plugin
2. Claude Code checks dependencies
3. Automatically installs orchestration plugin
4. Skills become available to your agents/commands

### Option 2: Explicit Installation

Users install orchestration plugin directly:

```bash
/plugin install orchestration@mag-claude-plugins
```

**Use Case:** Users want orchestration patterns for custom agents/workflows

### Option 3: Global Installation

Install orchestration globally (available to all projects):

```bash
# Add marketplace (if not already added)
/plugin marketplace add MadAppGang/claude-code

# Install plugin globally
/plugin install orchestration@mag-claude-plugins --global
```

### Verify Installation

After installing, verify the orchestration plugin is available:

**Method 1: Check Plugin List**
```bash
/plugin list
```
Look for: `orchestration@mag-claude-plugins (v0.1.0)`

**Method 2: Test Skill Reference**
Create a test agent with:
```yaml
---
name: test-orchestration
skills: orchestration:multi-agent-coordination
---
```
If no errors appear, installation succeeded ✅

## Usage

### In Agent Prompts

Reference skills in agent frontmatter:

```yaml
---
name: my-orchestrator
description: Custom orchestration agent
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

### In Command Prompts

Reference skills in command frontmatter:

```yaml
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

### Skill Reference Syntax

```yaml
# Load specific skills
skills: orchestration:multi-model-validation, orchestration:quality-gates

# Load all skills
skills: orchestration:*

# Load skill bundles
skills: orchestration:core              # multi-agent-coordination + quality-gates
skills: orchestration:advanced          # multi-model-validation + error-recovery
skills: orchestration:testing           # quality-gates + error-recovery
skills: orchestration:complete          # all 5 skills
```

## When to Use Which Skills

| Workflow Type | Load Skills |
|--------------|-------------|
| Simple single-agent task | None (not needed) |
| Multi-agent sequential workflow | `multi-agent-coordination` + `todowrite-orchestration` |
| Multi-model validation | `multi-model-validation` + `quality-gates` + `todowrite-orchestration` + `error-recovery` |
| Complex multi-phase workflow | All 5 skills (use `orchestration:complete`) |
| User feedback loop | `quality-gates` + `todowrite-orchestration` |
| Parallel execution | `multi-agent-coordination` + `multi-model-validation` + `error-recovery` |
| Test-driven development | `quality-gates` + `error-recovery` + `todowrite-orchestration` |

## Examples

See detailed workflow examples in:
- `examples/parallel-review-example.md` - Multi-model code review with consensus
- `examples/multi-phase-workflow-example.md` - 5-phase implementation workflow
- `examples/consensus-analysis-example.md` - How to interpret consensus results

## Integration Example

### How Other Plugins Use Orchestration Skills

**Example: Custom Code Review Plugin**

```json
// plugins/my-review-plugin/plugin.json
{
  "name": "my-review-plugin",
  "version": "1.0.0",
  "dependencies": {
    "orchestration@mag-claude-plugins": "^0.1.0"
  }
}
```

```yaml
# plugins/my-review-plugin/agents/reviewer.md
---
name: my-code-reviewer
description: Reviews code with multi-model validation
skills: orchestration:multi-model-validation, orchestration:quality-gates
---

You are a code reviewer that uses multi-model validation for consensus.

When reviewing code:
1. Use the 4-Message Pattern for parallel execution
2. Run 3+ AI models (Grok, Gemini, GPT-5) via Claudish
3. Auto-consolidate results when N ≥ 2 reviews complete
4. Classify issues by severity (CRITICAL/HIGH/MEDIUM/LOW)
5. Present consensus analysis with unanimous/strong/divergent labels

Skills provide all orchestration patterns automatically.
```

**Result:** Your plugin automatically inherits proven orchestration patterns with zero code duplication.

## Quick Troubleshooting Guide

| Symptom | Likely Cause | Skill | Solution |
|---------|--------------|-------|----------|
| Parallel tasks run sequentially | Mixed tool types in same message | multi-model-validation | Use 4-Message Pattern: separate Bash and Task messages |
| External model timeout after 30s | Claudish proxy slow/unavailable | error-recovery | Check Claudish installation, increase timeout, use fallback |
| No progress visibility | Missing TodoWrite tracking | todowrite-orchestration | Initialize task list before workflow, mark completed immediately |
| Infinite iteration loop | No max iterations set | quality-gates | Add max iteration limit (10), define clear exit criteria |
| Context window exceeded | Too many skills loaded | multi-agent-coordination | Use skill bundles, delegate to sub-agents with file-based instructions |
| Consensus analysis shows all divergent | Models reviewing different things | multi-model-validation | Ensure all models receive identical prompts and file contexts |

**For detailed troubleshooting**, see individual skill SKILL.md files.

## Key Design Decisions

1. **5 Skills** - Added error-recovery from future enhancements (CRITICAL for production)
2. **Version 0.1.0** - Conservative initial release, mature to 1.0.0 after validation
3. **User-Centric Descriptions** - Trigger keywords (grok, gemini, claudish, parallel, consensus)
4. **Skill Bundles** - Predefined combinations (core, advanced, testing, complete)
5. **No Agents/Commands** - Pure skill plugin (orchestration knowledge only)
6. **No Dependencies** - Standalone, can be used by any plugin

## Version Strategy

### Current Version: v0.1.0
- Initial release with 5 skills and skill bundles
- Production-ready but conservative versioning
- Validation period: 2-3 months

### Roadmap to v1.0.0 (Estimated: Q1 2026)

**Quantitative Gates:**
- ✅ 100+ plugin installations (via dependencies)
- ✅ Used in 3+ production plugins (frontend, bun, code-analysis)
- ✅ 0 CRITICAL bugs in 90-day window
- ✅ GitHub issues: 0 CRITICAL open, <5 total open
- ✅ User satisfaction: 80%+ (surveys/feedback)

**Qualitative Gates:**
- ✅ All existing plugins using successfully
- ✅ No major API changes needed
- ✅ Documentation complete and accurate
- ✅ Community feedback incorporated

### Skill Versioning

Individual skills follow semantic versioning:

- **Patch (0.1.x):** Clarifications, typos, example improvements, minor bug fixes
- **Minor (0.x.0):** New patterns added, non-breaking enhancements, additional examples
- **Major (x.0.0):** Breaking changes to pattern structure, API changes, removed patterns

Plugin version matches highest skill version. All skills stay synchronized during updates.

## Contributing

This plugin is maintained by MadAppGang as part of the MAG Claude Plugins marketplace. Contributions are welcome!

**To contribute:**
1. Fork the repository
2. Create a feature branch
3. Add/improve skills or examples
4. Test with existing plugins
5. Submit pull request

## License

MIT License - see [LICENSE](../../LICENSE) file for details.

## Support

- **Homepage:** https://github.com/MadAppGang/claude-code
- **Issues:** https://github.com/MadAppGang/claude-code/issues
- **Author:** MadAppGang

---

**Maintained by:** MadAppGang
**Version:** 0.1.0
**Status:** Production Ready
**Last Updated:** November 22, 2025
