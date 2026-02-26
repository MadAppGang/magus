# Orchestration Plugin Design Document

**Plugin Name:** `orchestration`
**Version:** 1.0.0
**Purpose:** Shared multi-agent coordination and workflow orchestration patterns
**Status:** Design Phase
**Created:** November 22, 2025

---

## Executive Summary

The **orchestration plugin** extracts and centralizes sophisticated multi-agent coordination patterns from existing plugins (primarily frontend) into reusable, shareable skills. This enables all plugins to leverage proven orchestration patterns for:

- **Parallel multi-model execution** (3-5x speedup via Claudish proxy)
- **Multi-agent coordination** (sequential vs parallel execution strategies)
- **Quality gates and iteration loops** (approval gates, severity classification, consensus analysis)
- **TodoWrite integration** (phase tracking in complex workflows)

**Key Innovation:** Transforms hardcoded orchestration knowledge from command prompts into modular, context-efficient skills that can be loaded on-demand.

---

## 1. Plugin Manifest Design

### File: `plugins/orchestration/plugin.json`

```json
{
  "name": "orchestration",
  "version": "1.0.0",
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
    "coordination"
  ],

  "skills": [
    "multi-agent-coordination",
    "multi-model-validation",
    "quality-gates",
    "todowrite-orchestration"
  ],

  "dependencies": [],

  "compatibility": {
    "claudeCode": ">=1.0.0"
  }
}
```

**Key Design Decisions:**

1. **No agents or commands** - Pure skill plugin (orchestration knowledge only)
2. **No dependencies** - Standalone, can be used by any plugin
3. **Skill-focused** - All knowledge in modular, loadable skills
4. **Tags for discoverability** - Easy to find when searching for orchestration patterns

---

## 2. Skill Breakdown

### Skill 1: Multi-Agent Coordination

**File:** `plugins/orchestration/skills/multi-agent-coordination/SKILL.md`

**Purpose:** Patterns for coordinating multiple agents in complex workflows

**YAML Frontmatter:**

```yaml
---
name: multi-agent-coordination
description: Expert patterns for coordinating multiple agents in complex workflows. Use when orchestrating multi-agent sequences, choosing between parallel vs sequential execution, managing agent selection, and handling sub-agent delegation. Includes task detection logic, context window management, and agent switching strategies.
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
description: CRITICAL - Patterns for parallel multi-model validation via Claudish CLI with 3-5x speedup. Use when orchestrating external AI models (Grok, GPT-5, Gemini), implementing parallel code review, consensus analysis, or multi-model validation. Includes 4-Message Pattern, proxy mode implementation, blocking execution requirements, cost estimation with input/output separation, and auto-consolidation logic.
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
description: Patterns for implementing quality gates, user approval checkpoints, iteration loops, and severity-based issue classification. Use when orchestrating workflows with user validation, implementing feedback loops, managing issue severity (CRITICAL/HIGH/MEDIUM/LOW), or building multi-iteration validation workflows. Includes consensus-based prioritization and exit criteria.
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

**Extracted From:**
- `/review` command (consensus analysis, user approval for costs)
- `/validate-ui` command (mandatory user validation, feedback loops)
- `/implement` command (quality gates between phases, user acceptance)

---

### Skill 4: TodoWrite Orchestration

**File:** `plugins/orchestration/skills/todowrite-orchestration/SKILL.md`

**Purpose:** Patterns for using TodoWrite in complex multi-phase workflows

**YAML Frontmatter:**

```yaml
---
name: todowrite-orchestration
description: Patterns for using TodoWrite tool to track progress in complex multi-phase workflows. Use when orchestrating commands with 5+ phases, managing iteration loops, tracking parallel tasks, or providing real-time progress visibility. Includes phase initialization, task granularity guidelines, status transitions, and exactly-one-in-progress rule.
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

## 3. Content Extraction Map

### From `/review` Command → Orchestration Skills

| Source Section | Target Skill | Specific Content |
|---------------|-------------|------------------|
| `<parallel_execution_requirement>` | multi-model-validation | 4-Message Pattern, Task separation, speedup rationale |
| `<key_design_innovation>` | multi-model-validation | Parallel execution architecture, performance comparison |
| `<cost_estimation>` | multi-model-validation | Input/output token separation, range-based estimates |
| `<consensus_algorithm>` | multi-model-validation | Keyword-based matching, confidence levels |
| `<todowrite_requirement>` | todowrite-orchestration | 10-task initialization, phase tracking |
| Phase 2 (Model Selection) | quality-gates | User approval for costs, graceful degradation |
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
Skills Used: multi-model-validation + quality-gates + todowrite-orchestration

Phase 1: Initialize TodoWrite (todowrite-orchestration)
  ✓ Create 10-task list before starting

Phase 2: Cost Approval Gate (quality-gates)
  ✓ Present cost estimates with input/output separation
  ✓ Get user approval before proceeding

Phase 3: Parallel Review Execution (multi-model-validation)
  ✓ Follow 4-Message Pattern
  ✓ Launch all external models in single message
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
Skills Used: multi-agent-coordination + quality-gates + todowrite-orchestration

Phase 1: Agent Selection (multi-agent-coordination)
  ✓ Detect task type (UI implementation)
  ✓ Choose designer + ui-developer agents
  ✓ Optional: external model validation

Phase 2: Parallel Validation (multi-agent-coordination)
  ✓ Launch designer and designer-codex in parallel
  ✓ Single message, two Task calls
  ✓ Wait for both to complete

Phase 3: Iteration Loop (quality-gates)
  ✓ Check designer assessment
  ✓ If not PASS and < 10 iterations: loop
  ✓ Track with TodoWrite

Phase 4: User Validation Gate (quality-gates)
  ✓ MANDATORY manual validation
  ✓ Collect user feedback if issues found
  ✓ Loop until user approves
```

**Scenario 3: Complex Implementation Workflow**

```
Skills Used: all 4 skills together

Phase 1: Plan (multi-agent-coordination)
  ✓ Delegate to architect agent
  ✓ File-based instructions (context isolation)

Phase 2: Implement (multi-agent-coordination + todowrite-orchestration)
  ✓ Delegate to developer agent
  ✓ Track sub-tasks with TodoWrite

Phase 3: Test (multi-agent-coordination)
  ✓ Delegate to test-architect
  ✓ Sequential (depends on implementation)

Phase 4: Review (multi-model-validation + quality-gates)
  ✓ Parallel multi-model code review
  ✓ Consensus analysis
  ✓ User approval gate

Phase 5: Accept (quality-gates)
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
| Multi-model validation | `multi-model-validation` + `quality-gates` + `todowrite-orchestration` |
| Complex multi-phase workflow | All 4 skills |
| User feedback loop | `quality-gates` + `todowrite-orchestration` |
| Parallel execution | `multi-agent-coordination` + `multi-model-validation` |

**Auto-Loading Triggers (Proposed):**

Commands can auto-load skills based on keywords:

- User says "parallel review" → Load `multi-model-validation`
- User says "use multiple models" → Load `multi-model-validation`
- User says "run in parallel" → Load `multi-agent-coordination`
- Command has >3 phases → Load `todowrite-orchestration`
- Command has user approval → Load `quality-gates`

---

## 5. Installation and Usage Guide

### Installation Strategy

**Option 1: Dependency Declaration (Recommended)**

Plugins declare orchestration as a dependency:

```json
// plugins/frontend/plugin.json
{
  "name": "frontend",
  "version": "3.7.0",
  "dependencies": {
    "orchestration@magus": "^1.0.0"
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

### Using Skills in Agents/Commands

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

---

## 6. Migration Strategy and Backward Compatibility

### Migration Path

**Phase 1: Create Orchestration Plugin (v1.0.0)**
- Create plugin structure
- Write 4 skills with extracted content
- Add examples and documentation
- Test skills in isolation

**Phase 2: Add Dependency to Frontend Plugin (v3.7.0)**
- Update `plugins/frontend/plugin.json` to depend on orchestration
- Update command prompts to reference skills (optional, for clarity)
- Keep existing inline documentation (backward compatible)
- Release frontend v3.7.0 with dependency

**Phase 3: Gradual Skill References (v3.8.0+)**
- Replace inline orchestration patterns with skill references
- Example: `/review` command → Reference `multi-model-validation` skill
- Remove duplicate content from command prompts
- Keep critical information inline (don't over-abstract)

**Phase 4: Add to Other Plugins**
- Bun backend plugin (v1.3.0) - Add dependency
- Code analysis plugin (v1.2.0) - Add dependency
- Custom user plugins - Can opt-in

### Backward Compatibility Guarantees

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

### What NOT to Migrate

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

### Versioning Strategy

**Orchestration Plugin:**
- v1.0.0 - Initial release (4 skills)
- v1.1.0 - Add new pattern (e.g., "workflow-templates")
- v2.0.0 - Breaking changes to skill structure (rare)

**Dependent Plugins:**
- Use `^1.0.0` for flexible updates (recommended)
- Use `~1.0.0` for patch-only updates (conservative)
- Use `1.0.0` for exact version lock (not recommended)

**Example:**

```json
{
  "dependencies": {
    "orchestration@magus": "^1.0.0"
  }
}
```

This allows orchestration v1.1.0, v1.2.0, etc. (minor/patch updates) but not v2.0.0 (breaking changes).

---

## 7. Example Workflows Using Skills

### Example 1: Multi-Model Code Review

**User Request:** "Review my changes with multiple AI models"

**Orchestrator:** `/review` command

**Skills Loaded:**
- `multi-model-validation` (4-Message Pattern, parallel execution)
- `quality-gates` (cost approval, consensus analysis)
- `todowrite-orchestration` (10-task workflow tracking)

**Workflow:**

```
STEP 0: Initialize TodoWrite (todowrite-orchestration pattern)
  Tasks: [Phase 1 ask, Phase 1 gather, Phase 2 models, Phase 2 approval, ...]

STEP 1: Determine Review Target
  - Ask user what to review
  - Run git diff for unstaged changes
  - Write context to ai-docs/code-review-context.md
  - Mark Phase 1 complete

STEP 2: Model Selection and Cost Approval (quality-gates pattern)
  - Query claudish --list-models --json
  - Present options (up to 9 external + 1 embedded)
  - Calculate costs: INPUT (code × 1.5) + OUTPUT (2000-4000 range)
  - Ask user approval for estimated cost
  - Mark Phase 2 complete

STEP 3: Parallel Review Execution (multi-model-validation 4-Message Pattern)

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

  MESSAGE 3 (Auto-Consolidate - Task only):
    Automatically triggered when all 4 reviews complete

    Task: senior-code-reviewer (consolidation)
      Prompt: Read 4 review files, analyze consensus, prioritize

  MESSAGE 4 (Present):
    Show user:
    - Top 5 issues by consensus
    - Unanimous (100%) → MUST FIX
    - Strong (67-99%) → RECOMMENDED
    - Majority (50-66%) → CONSIDER
    - Link to detailed consolidated report

STEP 4: User Takes Action
  - Review detailed report
  - Fix prioritized issues
  - Re-run /review if needed
```

**Result:** Comprehensive multi-model review in ~5 minutes (vs 15+ sequential)

---

### Example 2: UI Validation with Feedback Loop

**User Request:** "/validate-ui" with Figma design

**Orchestrator:** `/validate-ui` command

**Skills Loaded:**
- `multi-agent-coordination` (parallel designer launch, agent selection)
- `quality-gates` (iteration loops, user validation, feedback handling)
- `todowrite-orchestration` (iteration tracking)

**Workflow:**

```
STEP 1: Gather Inputs (multi-agent-coordination pattern)
  - Ask user: design reference, component description, use external AI?
  - Auto-detect reference type (Figma/URL/file)
  - Find implementation files (Glob/Grep)
  - Select agents: designer, ui-developer, optional ui-developer-codex

STEP 2: Automated Iteration Loop (quality-gates pattern)

  For iteration 1 to 10 or until PASS:

    STEP 2.1: Parallel Designer Validation (multi-agent-coordination)
      If external AI enabled:
        Launch TWO designers in parallel (single message):
          Task: designer (fetch design, compare, report issues)
          ---
          Task: designer PROXY_MODE: design-review (external validation)
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

**Result:** Pixel-perfect UI validated by automation + human review

---

### Example 3: Full-Cycle Implementation

**User Request:** "/implement authentication feature"

**Orchestrator:** `/implement` command

**Skills Loaded:**
- `multi-agent-coordination` (task detection, sequential delegation)
- `quality-gates` (user approval gates, iteration loops)
- `todowrite-orchestration` (8-phase workflow tracking)
- `multi-model-validation` (optional for code review phase)

**Workflow:**

```
STEP 0: Initialize TodoWrite (todowrite-orchestration)
  Tasks: [Phase 1 plan, Phase 2 implement, Phase 3 test, ...]

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

STEP 3: Testing (multi-agent-coordination)
  Task: test-architect
    Prompt: Write comprehensive tests for authentication
    Sequential (depends on Phase 2)

  Run tests:
    Bash: bun test

  If tests fail (quality-gates):
    Loop with developer to fix (max 3 iterations)

  Mark Phase 3 complete

STEP 4: Code Review (multi-model-validation + quality-gates)

  Option A: User requests multi-model review
    Follow 4-Message Pattern:
      - Parallel execution with Grok + Gemini + embedded
      - Auto-consolidation
      - Consensus analysis

  Option B: Single embedded review
    Task: senior-code-reviewer

  If CRITICAL issues found (quality-gates):
    Loop with developer to fix
    Re-run review

  Mark Phase 4 complete

STEP 5: User Acceptance (quality-gates)

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

  Mark Phase 5 complete

STEP 6: Cleanup (multi-agent-coordination)
  Task: project-cleaner
    Remove temporary files, format code

STEP 7: Present Results
  - Summary of all phases
  - Files modified
  - Tests added
  - Code review verdict
  - User approval: ✅
```

**Result:** Complete feature from architecture to acceptance

---

## 8. Key Design Decisions

### Decision 1: Skills-Only Plugin (No Agents/Commands)

**Rationale:**
- Orchestration is **knowledge**, not **functionality**
- Agents/commands live in domain plugins (frontend, backend)
- Skills provide **reusable patterns** across all plugins
- Keeps orchestration plugin lightweight and focused

**Trade-off:**
- Can't demonstrate patterns with example commands
- Users must integrate into their own agents/commands

**Mitigation:**
- Provide detailed examples in each skill
- Reference existing commands (e.g., `/review` uses multi-model-validation)

---

### Decision 2: 4 Skills, Not 1 Monolithic Skill

**Rationale:**
- **Context efficiency** - Load only what you need
- **Skill specialization** - Each skill has clear purpose
- **Incremental adoption** - Use quality-gates without multi-model-validation
- **Maintainability** - Easier to update specific patterns

**Trade-off:**
- More files to maintain
- Skills have interdependencies (documented in Integration Patterns)

**Mitigation:**
- Clear skill descriptions (when to load which)
- Integration examples show how skills work together

---

### Decision 3: Dependency Model (Not Global Installation)

**Rationale:**
- **Automatic installation** - Users install frontend, get orchestration
- **Version locking** - Plugins control which orchestration version
- **Consistency** - All plugins use same orchestration patterns
- **Discoverability** - Users don't need to know orchestration exists

**Trade-off:**
- Plugin authors must add dependency
- Orchestration updates require plugin releases

**Mitigation:**
- Use `^1.0.0` for flexible updates
- Document migration path for plugin authors

---

### Decision 4: Keep Critical Content Inline in Commands

**Rationale:**
- **Visibility** - Orchestrators must see "no Write/Edit" constraints
- **Self-contained** - Commands work without skill loading
- **Backward compatible** - Existing commands unchanged
- **Fail-safe** - If skill load fails, command still has core instructions

**Trade-off:**
- Some content duplication (inline + skill)
- Larger command files

**Mitigation:**
- Skills provide **additional context** and **best practices**
- Commands provide **specific workflow** and **constraints**
- Balance: Critical inline, patterns in skills

---

### Decision 5: Skill Loading is Explicit (Not Automatic)

**Rationale:**
- **User control** - Agents/commands choose which skills to load
- **Context efficiency** - Don't load all 4 skills for simple tasks
- **Flexibility** - Custom agents can cherry-pick patterns
- **Transparency** - Clear what knowledge is loaded

**Trade-off:**
- Agents must know which skills they need
- Potential for incorrect skill selection

**Mitigation:**
- Clear skill descriptions with trigger keywords
- Integration patterns show which skills for which scenarios
- Auto-loading proposal for future enhancement

---

## 9. Success Criteria

### Plugin Creation Success

✅ **Orchestration plugin installable**
- Valid plugin.json manifest
- 4 skills with complete content
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

### Adoption Success (6 months)

✅ **Plugin adoption**
- Frontend, bun, code-analysis plugins depend on orchestration
- 100+ installations via dependencies
- Positive user feedback

✅ **Skill usage**
- Agents reference skills in prompts
- Custom user agents leverage patterns
- Reduced command prompt sizes (patterns moved to skills)

✅ **Pattern validation**
- Multi-model validation used in production
- 4-Message Pattern achieves 3-5x speedup
- Quality gates prevent issues from reaching users

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

### v1.2.0: Error Recovery Patterns

**New Skill:** `error-recovery`

**Purpose:** Patterns for handling agent failures, timeout, retries

**Content:**
- Retry strategies (exponential backoff, max retries)
- Fallback agents (if preferred agent fails)
- Graceful degradation (external model → embedded)
- Partial success handling (some agents succeed, others fail)

### v1.3.0: Performance Optimization

**Enhancement to existing skills:**
- **multi-agent-coordination:** Add caching patterns for repeated agent calls
- **multi-model-validation:** Add model selection by cost/speed trade-off
- **todowrite-orchestration:** Add progress estimation (time remaining)

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
description: When to use, trigger keywords, max 1024 chars
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
      └─ Orchestration Plugin (v1.0.0)
          ├─ multi-agent-coordination skill
          ├─ multi-model-validation skill
          ├─ quality-gates skill
          └─ todowrite-orchestration skill

  └─ Bun Backend Plugin (v1.3.0+)
      └─ Orchestration Plugin (v1.0.0)
          └─ [same skills]

  └─ Code Analysis Plugin (v1.2.0+)
      └─ Orchestration Plugin (v1.0.0)
          └─ [same skills]

  └─ Custom User Plugin
      └─ Orchestration Plugin (v1.0.0) [optional]
```

### Appendix C: Migration Checklist for Plugin Authors

**Adding Orchestration Dependency to Your Plugin:**

- [ ] Add orchestration to `plugin.json` dependencies:
  ```json
  "dependencies": {
    "orchestration@magus": "^1.0.0"
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
**Version:** 1.0.0
**Skills:** 4 (multi-agent-coordination, multi-model-validation, quality-gates, todowrite-orchestration)

**Key Design Decisions:**
1. **Skills-only plugin** - No agents/commands, pure knowledge
2. **Dependency model** - Plugins auto-install orchestration
3. **Context-efficient** - Load only needed skills (4 focused skills vs 1 monolithic)
4. **Backward compatible** - Existing commands unchanged, skills add context
5. **Integration patterns documented** - Clear guidance on which skills for which scenarios

**Integration Approach:**
- Frontend plugin (v3.7.0+) depends on orchestration
- Other plugins (bun, code-analysis) can add dependency
- Custom user agents can cherry-pick skills
- Skills provide patterns, commands provide workflows

**Migration Strategy:**
- Phase 1: Create orchestration plugin (v1.0.0)
- Phase 2: Add dependency to frontend (v3.7.0)
- Phase 3: Gradual skill references (v3.8.0+)
- Phase 4: Extend to other plugins

**File Location:** `ai-docs/plugin-design-orchestration.md`

**Next Steps:**
1. Review this design document
2. Create orchestration plugin structure
3. Write 4 skills with extracted content
4. Add dependency to frontend plugin
5. Test integration and skill loading
6. Release orchestration v1.0.0 + frontend v3.7.0

---

**Maintained by:** MadAppGang
**Design Date:** November 22, 2025
**Design Version:** 1.0
**Status:** Ready for Implementation
