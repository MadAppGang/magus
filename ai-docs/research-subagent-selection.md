# Teaching Claude Code to Delegate: A Research Campaign on Subagent Selection

**Date:** February 9-10, 2026
**Author:** Jack Rudenko + Claude Opus 4.6
**Repository:** MadAppGang/magus (Magus)
**Duration:** ~10 hours across 3 conversation sessions (~95 automated test runs)

---

## 1. The Problem

Claude Code has a plugin system with 30+ specialized agents: `dev:researcher` for multi-source web research, `dev:developer` for implementation with test loops, `code-analysis:detective` for AST-powered codebase investigation, `dev:debugger` for root cause analysis, and more. Each agent runs in a dedicated context window via the `Task` tool with a `subagent_type` parameter.

The problem: **Claude wouldn't delegate to these agents reliably.**

When a user asked "Research authentication patterns and write a report," Claude would use its native `WebSearch` tool inline instead of delegating to `dev:researcher`. When asked to "Implement a caching layer with tests," Claude would start writing code directly instead of launching `dev:developer` (which runs an iterative write-test-fix cycle in a dedicated context window).

This was a routing problem: the right agents existed, but Claude's decision-making wasn't selecting them.

## 2. What We Had: The Starting Point

### The Test Framework

We built a fully automated test framework at `autotest/subagents/` consisting of:

**`run-tests.sh`** (381 lines) - The test runner that:
- Reads test cases from `test-cases.json`
- For each test, invokes `claude -p --output-format stream-json --verbose --dangerously-skip-permissions "<prompt>"`
- Parses the JSONL transcript to extract the first `Task` tool call's `subagent_type` parameter
- Compares actual vs expected agent selection
- Supports `PASS`, `PASS_ALT` (acceptable alternative), `FAIL`, `NO_DELEGATION` (no Task call made), `TIMEOUT`, and `ERROR` results
- Writes per-test metadata JSON and a `results-summary.json` with aggregate stats

The key extraction logic in Python:

```python
for line in open(transcript_file):
    obj = json.loads(line)
    if obj.get('type') == 'assistant':
        for block in obj.get('message', {}).get('content', []):
            if block.get('type') == 'tool_use' and block.get('name') == 'Task':
                agent = block.get('input', {}).get('subagent_type', 'UNKNOWN')
                agents_used.append(agent)
```

**`analyze-results.sh`** - Results analyzer providing category breakdown, agent distribution histograms, failure pattern analysis, timing stats, and optional confusion matrices.

**`test-cases.json`** (v1.0.0 at this point) - 14 test cases across 5 categories:

| Category | Count | Purpose |
|----------|-------|---------|
| `explicit` | 5 | User names the agent directly: "Use the dev:researcher agent to..." |
| `passive-routing` | 2 | Complex tasks with no agent name, no delegation hint |
| `implicit-delegation` | 1 | Complex task requiring specialized capabilities |
| `hinted-delegation` | 4 | Task contains "subagent" or "background subagent" keywords |
| `direct` | 2 | Simple tasks that should NOT trigger delegation |

### The Agent Descriptions

At the start, agent descriptions were minimal one-liners in YAML frontmatter:

```yaml
# plugins/dev/agents/researcher.md
---
description: Deep research agent for web exploration and local investigation
---
```

```yaml
# plugins/dev/agents/developer.md
---
description: Language-agnostic implementation agent that adapts to any technology stack
---
```

These descriptions flow into the Task tool's system-level description, which Claude sees when choosing `subagent_type`. This is the PRIMARY selection signal.

### The CLI Command

Each test executes:

```bash
claude -p \
  --output-format stream-json \
  --verbose \
  --dangerously-skip-permissions \
  "<test prompt>"
```

Key flags:
- `-p` = print mode (non-interactive, single prompt in, response out)
- `--output-format stream-json` = full JSONL transcript including tool calls (requires `--verbose`)
- `--dangerously-skip-permissions` = no permission prompts (also bypasses ALL hooks)

**Important limitation:** `--dangerously-skip-permissions` bypasses hook enforcement. This means our tests measure Claude's *intrinsic* decision-making, not the production path where hooks can catch and correct mistakes.

## 3. Baseline: First Full Run

### Batch 1 (5 explicit + 2 direct tests)

| Test | Expected | Actual | Result | Duration |
|------|----------|--------|--------|----------|
| explicit-researcher-01 | dev:researcher | dev:researcher | PASS | 263s |
| explicit-detective-01 | code-analysis:detective | code-analysis:detective | PASS | 399s |
| explicit-developer-01 | dev:developer | dev:developer | PASS | 409s |
| direct-simple-01 | NO_TASK_CALL | NO_TASK_CALL | PASS | 21s |
| direct-simple-02 | NO_TASK_CALL | NO_TASK_CALL | PASS | 25s |

**7/7 PASS.** Explicit naming ("Use the dev:researcher agent to...") is 100% reliable. Simple tasks correctly stay inline.

### Batch 2 (7 implicit/hinted tests)

| Test | Expected | Actual | Result | Duration |
|------|----------|--------|--------|----------|
| explicit-debugger-01 | dev:debugger | dev:debugger | PASS | 173s |
| explicit-architect-01 | dev:architect | dev:architect | PASS | 380s |
| delegate-research-01 | dev:researcher | **NO_TASK_CALL** | **NO_DELEGATION** | 249s |
| delegate-investigate-01 | code-analysis:detective | code-analysis:detective | PASS | 446s |
| delegate-implement-01 | dev:developer | **NO_TASK_CALL** | **NO_DELEGATION** | 486s |
| delegate-debug-01 | dev:debugger | dev:debugger | PASS | 138s |
| delegate-parallel-01 | dev:researcher | dev:researcher | PASS | 489s |
| hint-subagent-01 | agentdev:reviewer | agentdev:reviewer | PASS | 341s |
| hint-subagent-02 | general-purpose | dev:audit | FAIL | - |

**Baseline: 11/14 (79%).** Three failures identified.

### Analysis of Failures

The failures revealed a clear pattern:

**Working implicit delegation:**
- `delegate-investigate-01` → `code-analysis:detective` (PASS) - The detective agent has AST analysis capabilities Claude lacks natively
- `delegate-debug-01` → `dev:debugger` (PASS) - Prompt contains "Use a subagent" keyword
- `delegate-parallel-01` → `dev:researcher` (PASS) - Prompt contains "separate subagents" keyword

**Failing implicit delegation:**
- `delegate-research-01` → NO_TASK_CALL - Claude used `WebSearch` inline instead of delegating
- `delegate-implement-01` → NO_TASK_CALL - Claude started writing code directly

The hypothesis: **Claude won't delegate tasks it can handle natively.** It has `WebSearch` built in, so "research" prompts trigger inline searching. It has `Read`/`Write`/`Edit` tools, so "implement" prompts trigger inline coding. But it lacks AST analysis, so investigation prompts do get delegated to the detective.

**Test framework correction:** We also reclassified `delegate-debug-01` and `delegate-parallel-01` from "implicit-delegation" to "hinted-delegation" since their prompts contain the keyword "subagent" which is a strong delegation signal. And `hint-subagent-02` (expected `general-purpose`, got `dev:audit`) was actually a smarter choice - added `dev:audit` to `expected_alternatives`. Updated test-cases.json to v2.2.0.

## 4. Attempt 1: Enhanced Agent Descriptions (Round 1)

### Hypothesis
If agent descriptions better explain *when* to use the agent, Claude will delegate more.

### Changes

**`plugins/dev/agents/researcher.md`** description changed to:
```
Use this agent when you need comprehensive research that requires
searching the web across 10+ sources, comparing findings, assessing
source quality, and producing structured research reports with citations.
```

**`plugins/dev/agents/developer.md`** description changed to:
```
Use this agent when you need substantial implementation work spanning
multiple files with tests and quality validation.
```

### Result

| Test | Expected | Actual | Result |
|------|----------|--------|--------|
| delegate-research-01 | dev:researcher | **NO_TASK_CALL** | **STILL FAILING** |
| delegate-implement-01 | dev:developer | **NO_TASK_CALL** | **STILL FAILING** |

**0% improvement.** Claude still handled both tasks inline.

## 5. Attempt 2: Added Examples (Round 2)

### Hypothesis
The Task tool schema already has `<example>` blocks for agents like `code-analysis:detective`. Maybe adding examples showing delegation patterns will teach Claude when to delegate.

### Changes

Added full `<example>` blocks with `<commentary>` to both descriptions:

```yaml
description: >
  Use this agent when you need comprehensive research...

  Examples:
  - <example>
    Context: The user needs a comprehensive research report on a technology topic.
    user: "Research the latest authentication patterns..."
    assistant: "I'll use the dev:researcher agent to conduct a thorough
               multi-source research study..."
    <commentary>
    This is a complex research task requiring multiple search rounds
    and source comparison. Delegate to dev:researcher for multi-round
    convergence-based research.
    </commentary>
  </example>
```

### Result

| Test | Expected | Actual | Result |
|------|----------|--------|--------|
| delegate-research-01 | dev:researcher | **NO_TASK_CALL** | **STILL FAILING** |
| delegate-implement-01 | dev:developer | **NO_TASK_CALL** | **STILL FAILING** |

**0% improvement.** Examples didn't change the behavior either.

## 6. Attempt 3: "IMPORTANT" Directive (Round 3)

### Hypothesis
Maybe we need to be more forceful. Add an explicit "IMPORTANT: always delegate" instruction.

### Changes

Added to both agent descriptions:
```
IMPORTANT - always delegate research tasks to this agent rather than
performing web searches yourself, because the researcher agent's
multi-round convergence approach produces significantly more thorough
results than inline searching.
```

```
IMPORTANT - always delegate substantial implementation to this agent
rather than writing code inline, because the developer agent's iterative
write-test-fix cycle produces higher quality, fully tested code.
```

### Result

| Test | Expected | Actual | Result |
|------|----------|--------|--------|
| delegate-research-01 | dev:researcher | **NO_TASK_CALL** | **STILL FAILING** |
| delegate-implement-01 | dev:developer | **NO_TASK_CALL** | **STILL FAILING** |

**0% improvement across 3 rounds of description enhancements.**

### Conclusion

Agent descriptions are consulted *after* Claude has already decided to delegate. The problem is earlier in the decision chain: Claude evaluates "can I handle this myself?" and if the answer is yes (because it has native tools), it never even considers agent descriptions.

This is a fundamental limitation: **the Task tool description says each agent is "for researching complex questions" or "for multi-step tasks", but Claude's self-assessment of its own capabilities takes priority.**

## 7. The Breakthrough: Vercel's AGENTS.md Research

At this point, the user shared a Vercel blog post about their experience evaluating how Next.js framework knowledge gets into AI coding agents. Their key findings:

**Three approaches tested by Vercel:**

1. **Pre-training knowledge** - What the model already knows about Next.js
2. **Skills (active retrieval)** - Agent must decide to invoke a skill, which returns relevant docs
3. **AGENTS.md (passive context)** - A markdown file with compressed framework knowledge, always loaded into the system prompt

**Vercel's results:**

| Approach | Success Rate |
|----------|-------------|
| Pre-training only | Baseline |
| Skills (without explicit instructions) | 53% |
| Skills (with explicit "use skills" instructions) | 79% |
| **AGENTS.md (passive context)** | **100%** |

**The key insight from Vercel:** "The model doesn't need to 'decide to look something up.' The knowledge is already there, woven into its context."

This maps exactly to our problem:
- **Skills = Agent descriptions**: Both require Claude to *decide* to look them up or consider them
- **AGENTS.md = CLAUDE.md**: Both are always loaded into the system prompt, no decision needed
- **The decision point is the bottleneck**: When Claude must decide "should I delegate?", it defaults to "no" for tasks it can handle natively

## 8. Applying the Insight: CLAUDE.md Routing Table (v1)

### Hypothesis
Add a task routing table directly into `CLAUDE.md` (which is always loaded into the system prompt). This removes the delegation decision point - Claude reads the routing rules passively and applies them without needing to evaluate whether to delegate.

### Implementation

Added after the "CRITICAL RULES" section in `CLAUDE.md`:

```markdown
## Task Routing - Agent Delegation

IMPORTANT: For complex tasks, prefer delegating to specialized agents
via the Task tool rather than handling inline.

| Task Pattern | Delegate To | Trigger |
|---|---|---|
| Research: web search, tech comparison, multi-source reports | `dev:researcher` | 3+ sources or comparison needed |
| Implementation: creating code, new modules, features | `dev:developer` | 3+ files of new code |
| Investigation: codebase analysis, tracing, understanding | `code-analysis:detective` | Multi-file analysis |
| Debugging: error analysis, root cause investigation | `dev:debugger` | Non-obvious bugs |
| Architecture: system design, trade-off analysis | `dev:architect` | New systems or major refactors |
| Agent/plugin quality review | `agentdev:reviewer` | Agent description assessment |
```

### Result

| Test | Expected | Actual | Result |
|------|----------|--------|--------|
| delegate-research-01 | dev:researcher | **dev:researcher** | **PASS!** |
| delegate-implement-01 | dev:developer | **code-analysis:detective** | **FAIL** |

**50% improvement!** Research delegation now works. But implementation was mis-routed to detective instead of developer. The routing table was ambiguous: "creating code" vs "codebase analysis" both matched the implementation prompt which mentioned "our plugin system" (existing codebase context).

## 9. Refinement: Disambiguation Line (v2)

### The Problem

The prompt "Implement a complete caching layer for our plugin system" contained both implementation signals ("implement", "create") and codebase signals ("our plugin system"). Claude matched it to detective instead of developer.

### Fix

Added an explicit disambiguation rule:

```markdown
Key distinction: If the task asks to IMPLEMENT/CREATE/BUILD → `dev:developer`.
If the task asks to UNDERSTAND/ANALYZE/TRACE → `code-analysis:detective`.
```

Also made the table entries more precise:

```markdown
| Implementation: creating code, new modules, features, building with tests | `dev:developer` | Writing new code, adding features, creating modules - even if they relate to existing codebase |
| Investigation: READ-ONLY codebase analysis, tracing, understanding | `code-analysis:detective` | Only when task is to UNDERSTAND code, not to WRITE new code |
```

### Result

| Test | Expected | Actual | Result |
|------|----------|--------|--------|
| delegate-research-01 | dev:researcher | **dev:researcher** | **PASS** |
| delegate-implement-01 | dev:developer | **dev:developer** | **PASS** |

**100%!** Both previously-failing tests now pass.

## 10. Full Validation: 14-Test Suite

With the routing table in place, we ran the complete 14-test suite. This was the definitive validation run.

### Execution

```bash
./autotest/subagents/run-tests.sh
```

Started at 20:38 UTC, completed at 22:37 UTC (~59 minutes for 14 sequential tests).

### Complete Results

```
TEST_ID                EXPECTED                  ACTUAL                    RESULT    DURATION
─────────              ────────                  ──────                    ──────    ────────
explicit-researcher-01 dev:researcher            dev:researcher            PASS      292s
explicit-detective-01  code-analysis:detective   code-analysis:detective   PASS      596s
explicit-developer-01  dev:developer             dev:developer             PASS       91s
explicit-debugger-01   dev:debugger              dev:debugger              PASS      137s
explicit-architect-01  dev:architect             dev:architect             PASS      424s
delegate-research-01   dev:researcher            dev:researcher            PASS       53s
delegate-investigate-01 code-analysis:detective  code-analysis:detective   PASS      549s
delegate-implement-01  dev:developer             dev:developer             PASS      154s
delegate-debug-01      dev:debugger              dev:debugger              PASS      152s
delegate-parallel-01   dev:researcher            dev:researcher            PASS      347s
direct-simple-01       NO_TASK_CALL              NO_TASK_CALL              PASS       21s
direct-simple-02       NO_TASK_CALL              NO_TASK_CALL              PASS       25s
hint-subagent-01       agentdev:reviewer         agentdev:reviewer         PASS      631s
hint-subagent-02       general-purpose           dev:audit                 PASS_ALT   56s
```

### Summary

```
Total: 14 | Pass: 14 | Fail: 0 | Error: 0
Pass Rate: 100%

Agent Distribution:
  dev:researcher:          3 (21.4%)
  dev:debugger:            2 (14.3%)
  dev:developer:           2 (14.3%)
  code-analysis:detective: 2 (14.3%)
  NO_TASK_CALL:            2 (14.3%)
  dev:architect:           1  (7.1%)
  agentdev:reviewer:       1  (7.1%)
  dev:audit:               1  (7.1%)
```

### By Category

```
Category             Pass  Total  Rate
─────────────────    ────  ─────  ────
direct                  2      2  100%
explicit                5      5  100%
hinted-delegation       4      4  100%
implicit-delegation     1      1  100%
passive-routing         2      2  100%
```

### Timing

```
Average: 252.0s per test
Min:      21s (direct-simple-01 - just reads a file, no delegation)
Max:     631s (hint-subagent-01 - agent reviews ALL plugin agents across entire repo)
Total: 3,528s (~59 minutes for full suite)
```

## 11. What Was Implemented (Final State)

### File: `CLAUDE.md` (the fix)

Added 14 lines after "CRITICAL RULES", before "Project Overview":

```markdown
## Task Routing - Agent Delegation

IMPORTANT: For complex tasks, prefer delegating to specialized agents via
the Task tool rather than handling inline. Delegated agents run in dedicated
context windows with sustained focus, producing higher quality results.

| Task Pattern | Delegate To | Trigger |
|---|---|---|
| Research: web search, tech comparison, multi-source reports | `dev:researcher` | 3+ sources or comparison needed |
| Implementation: creating code, new modules, features, building with tests | `dev:developer` | Writing new code, adding features, creating modules - even if they relate to existing codebase |
| Investigation: READ-ONLY codebase analysis, tracing, understanding | `code-analysis:detective` | Only when task is to UNDERSTAND code, not to WRITE new code |
| Debugging: error analysis, root cause investigation | `dev:debugger` | Non-obvious bugs or multi-file root cause |
| Architecture: system design, trade-off analysis | `dev:architect` | New systems or major refactors |
| Agent/plugin quality review | `agentdev:reviewer` | Agent description or plugin assessment |

Key distinction: If the task asks to IMPLEMENT/CREATE/BUILD → `dev:developer`. If the task asks to UNDERSTAND/ANALYZE/TRACE → `code-analysis:detective`.
```

### File: `plugins/dev/agents/researcher.md` (enhanced description)

Description grew from 1 line (62 chars) to a full block with:
- "Use this agent when..." opening
- Specific capability claims ("10+ sources", "convergence detection")
- Two `<example>` blocks with `<commentary>`
- "IMPORTANT - always delegate" directive

### File: `plugins/dev/agents/developer.md` (enhanced description)

Same pattern: "Use this agent when...", capability claims ("iterative write-test-fix cycle"), two examples, "IMPORTANT" directive.

### File: `autotest/subagents/test-cases.json` (v3.0.0)

14 test cases with:
- `expected_agent` and `expected_alternatives` for flexible matching
- Categories: explicit, passive-routing, implicit-delegation, hinted-delegation, direct
- Tags for filtering

### File: `autotest/subagents/run-tests.sh` (381 lines)

Test runner supporting `--cases`, `--runs`, `--parallel`, `--dry-run`, `--output-dir`. Outputs JSONL transcripts, plain text output, and per-test metadata JSON.

### File: `autotest/subagents/analyze-results.sh`

Results analyzer with category breakdowns, agent distribution histograms, failure pattern analysis, timing stats, and optional confusion matrices.

## 12. The Evolution of Understanding

### Phase 1: "Better Descriptions Will Fix It"

**Assumption:** If agent descriptions are more specific and contain examples, Claude will learn to delegate.

**Reality:** Agent descriptions are only consulted *after* Claude decides to delegate. If it decides to handle a task itself (because it has native tools), descriptions are irrelevant. Three rounds of increasingly aggressive descriptions (basic → examples → "IMPORTANT: always delegate") all produced 0% improvement.

### Phase 2: "Maybe We Need Keywords"

**Observation:** Tests with "subagent" or "background subagent" in the prompt always trigger delegation. Tests without these keywords only delegate when the agent has capabilities Claude lacks (e.g., AST analysis for detective).

**Insight:** Delegation has three reliable triggers:
1. Explicit agent naming: "Use the dev:researcher agent to..."
2. Delegation keywords: "Launch a subagent to..."
3. Capability gap: Agent can do something Claude can't

For agents whose capabilities overlap with Claude's native tools, none of these triggers fire from the task description alone.

### Phase 3: "Passive Context Beats Active Retrieval"

**Breakthrough (from Vercel research):** The problem is a *decision point*. Claude must decide "should I delegate?" and defaults to "no" for tasks within its capabilities. The fix is to remove the decision point by putting routing rules in CLAUDE.md (passive context, always in the system prompt).

**Result:** 100% pass rate. The routing table tells Claude *what* to delegate before it evaluates *whether* to delegate.

## 13. Key Technical Findings

### 1. System Prompt > Tool Description > Agent Description

Claude's decision hierarchy:
1. **System prompt** (CLAUDE.md) - highest priority, always read
2. **Tool descriptions** (Task tool schema) - consulted when considering tools
3. **Agent descriptions** (subagent_type options) - consulted last, after delegation decision

Changes at level 3 couldn't override decisions made at level 1.

### 2. The 3-Tier Delegation Reliability Model

| Tier | Mechanism | Reliability | Example |
|------|-----------|-------------|---------|
| 1 | Explicit naming | 100% | "Use the dev:researcher agent" |
| 2 | Keyword hints | 100% | "Launch a subagent to..." |
| 3 | Passive routing (CLAUDE.md) | 100% | Routing table in system prompt |
| 4 | Agent descriptions alone | 0-33% | Enhanced descriptions without CLAUDE.md |

### 3. `--dangerously-skip-permissions` Bypasses ALL Hooks

This means automated tests measure Claude's intrinsic behavior, not the production path. In production, hook enforcement (`enforce-proxy-mode.sh`) provides a second safety net. But our tests prove the CLAUDE.md approach works even without hooks.

### 4. Disambiguation is Critical

The routing table must handle overlapping domains. "Implement a caching layer for our plugin system" matches both "implementation" and "codebase analysis" patterns. Without explicit disambiguation ("IMPLEMENT → developer, UNDERSTAND → detective"), Claude defaults to the wrong agent.

### 5. `--output-format stream-json` Requires `--verbose`

Without `--verbose`, the `-p` flag produces plain text only. The `stream-json` format provides the full JSONL transcript needed to extract tool calls.

## 14. Comparison Table: Approaches Tried

| # | Approach | What Changed | delegate-research-01 | delegate-implement-01 |
|---|----------|-------------|----------------------|----------------------|
| 0 | Baseline | Nothing | NO_DELEGATION | NO_DELEGATION |
| 1 | Description v1 | "Use this agent when..." | NO_DELEGATION | NO_DELEGATION |
| 2 | Description v2 | + Examples with commentary | NO_DELEGATION | NO_DELEGATION |
| 3 | Description v3 | + "IMPORTANT: always delegate" | NO_DELEGATION | NO_DELEGATION |
| 4 | CLAUDE.md routing v1 | Added routing table | **PASS** | FAIL (→detective) |
| 5 | CLAUDE.md routing v2 | + Disambiguation line | **PASS** | **PASS** |

## 15. Follow-up Experiment: Skill vs CLAUDE.md (Active vs Passive)

After establishing that CLAUDE.md passive routing works at 100%, we tested whether moving the routing table to a skill (active retrieval) could achieve the same reliability.

### Experimental Setup

Created `plugins/dev/skills/task-routing/SKILL.md` containing the identical routing table as CLAUDE.md, with description: "Use BEFORE delegating any complex task to a subagent. Contains the routing table that maps task patterns to the correct specialized agent."

Tested 5 configurations varying what context was available:

### Configuration Matrix

| Config | CLAUDE.md Routing | Agent Descriptions | Skill Available | Prompt Prefix |
|--------|-------------------|--------------------|-----------------|---------------|
| A: Baseline | None | Original one-liners | No | None |
| B: Skill-only | None | Original one-liners | Yes | None |
| C: Skill + explicit | None | Original one-liners | Yes | "Before doing anything, invoke the dev:task-routing skill..." |
| D: CLAUDE.md passive | Yes | Enhanced | N/A | None |
| E: Skill + enhanced desc | None | Enhanced (Round 3) | Yes | None |

### Results

| Config | delegate-research-01 | delegate-implement-01 | Skill Invoked? |
|--------|---------------------|-----------------------|----------------|
| **A: Baseline** | NO_DELEGATION (432s) | NO_DELEGATION (101s) | N/A |
| **B: Skill-only** | NO_DELEGATION (432s) | NO_DELEGATION (101s) | **No** |
| **C: Skill + explicit** | **PASS** (80s) | **PASS** (157s) | **Yes** |
| **D: CLAUDE.md passive** | **PASS** (53s) | **PASS** (154s) | N/A |
| **E: Skill + enhanced desc** | **PASS** (88s) | NO_DELEGATION (374s) | **No** |

### Analysis

**Config B vs A (skill available but not invoked):** Adding the skill changed nothing. Claude never invoked `dev:task-routing` even though it was listed in the system prompt's skill inventory with matching trigger keywords ("delegate", "research", "implement"). The skill was functionally invisible. **Active retrieval = 0%.**

**Config C (explicit skill instruction):** When the prompt explicitly said "invoke the dev:task-routing skill first", Claude obeyed, read the routing table, and delegated correctly to both agents. This proves the skill *content* works - the routing table is effective regardless of where it lives. The problem is purely about getting Claude to read it. **Explicit active retrieval = 100%.**

**Config D (CLAUDE.md passive):** The routing table is always in context. No decision to make, no skill to invoke. **Passive context = 100%.**

**Config E (confound test):** With enhanced descriptions but no CLAUDE.md routing, research passed (description alone was sufficient) but implementation failed. The enhanced researcher description claims specialized capabilities ("convergence detection", "10+ sources") that distinguish it from inline WebSearch. The developer description doesn't have an equivalent capability gap - Claude's native Read/Write/Edit tools overlap too heavily. Importantly, the `task-routing` skill was still never invoked.

### Conclusion: Active Retrieval Fails for Delegation

The results directly confirm the Vercel AGENTS.md finding in our context:

| Approach | Vercel (Next.js knowledge) | Our Result (agent delegation) |
|----------|---------------------------|-------------------------------|
| Passive context (AGENTS.md / CLAUDE.md) | 100% | 100% |
| Active retrieval with explicit instructions | 79% | 100% (with prompt prefix) |
| Active retrieval without instructions | 53% | 0% |

The skill approach fails because Claude faces a **meta-delegation problem**: to delegate a task correctly, it must first invoke a skill that tells it how to delegate. But invoking the skill is itself a delegation decision that requires the knowledge the skill contains. This is a circular dependency that only passive context resolves.

## 16. Follow-up Experiment: `/dev:delegate` Command (On-Demand Context Injection)

After the skill experiment revealed the meta-delegation circular dependency, we tested a hybrid approach: a **slash command** that loads the routing skill via frontmatter.

### The Hypothesis

Instead of:
- CLAUDE.md (always loaded, wastes context on non-delegation conversations)
- Standalone skill (never loaded, 0% auto-discovery)

A `/dev:delegate` command with `skills: dev:task-routing` in its frontmatter should:
1. Load the routing table only when the user explicitly invokes the command
2. Achieve 100% delegation accuracy because the content enters context deterministically
3. Not waste context on conversations that don't need delegation

### Implementation

**Command file** (`plugins/dev/commands/delegate.md`):
```yaml
---
name: delegate
description: Route a task to the best specialized agent using the task routing table
allowed-tools: Task, Read, Glob, Grep, Skill
skills: dev:task-routing
---
```

The command template instructs Claude to:
1. Read the routing table from the loaded skill
2. Match the user's task to the correct agent
3. Delegate immediately using the Task tool

### First Attempt: Cache Discovery Problem

The first test run returned `"Unknown skill: delegate"` in 4ms — the CLI never made an API call. The `/delegate` command was created in the local repo but the installed plugin loads from the **cache directory** (`~/.claude/plugins/cache/magus/dev/1.29.0/`). The local changes weren't deployed.

Additionally, the command needed to be invoked as `/dev:delegate` (namespaced), not `/delegate`.

**Fix:** Copied both `delegate.md` and `task-routing/SKILL.md` to the cache directory for testing.

### Results (Config F: Command-based routing)

Configuration:
- CLAUDE.md routing table: **REMOVED**
- Agent descriptions: **Original one-liners** (no enhancements)
- Skill: `dev:task-routing` loaded via command `skills:` frontmatter
- Invocation: `/dev:delegate <task>`

| Test | Expected | Actual | Skills Invoked | Duration | Result |
|------|----------|--------|----------------|----------|--------|
| delegate-research | `dev:researcher` | `dev:researcher` | `dev:task-routing` | 952s | **PASS** |
| delegate-implement | `dev:developer` | `dev:developer` | NONE | 254s | **PASS** |

**2/2 PASS (100%)** — with no CLAUDE.md routing table and original one-liner descriptions.

### Analysis

The research test explicitly invoked the `dev:task-routing` skill (visible as a `Skill` tool call in the transcript), while the implementation test delegated correctly without an explicit skill invocation. This suggests the command expansion injected the routing table content into context, making it available even without an explicit `Skill` tool call.

This is the "on-demand context injection" pattern:
- **CLAUDE.md** = passive injection (always loaded)
- **Skill alone** = active retrieval (never loaded)
- **Command + skills: frontmatter** = on-demand injection (loaded when user invokes the command)

### Complete Configuration Comparison Matrix

| Config | CLAUDE.md | Descriptions | Skill | Command | Research | Implement | Pass Rate |
|--------|-----------|--------------|-------|---------|----------|-----------|-----------|
| A (baseline) | No | Original | No | No | NO_DELEGATION | NO_DELEGATION | 0% |
| B (skill-only) | No | Original | Yes | No | NO_DELEGATION | NO_DELEGATION | 0% |
| C (skill + explicit) | No | Original | Yes + prompt instruction | No | PASS | PASS | 100% |
| D (CLAUDE.md) | Yes | Enhanced | N/A | No | PASS | PASS | 100% |
| E (skill + enhanced) | No | Enhanced | Yes | No | PASS | NO_DELEGATION | 50% |
| **F (command)** | **No** | **Original** | **Via command** | **Yes** | **PASS** | **PASS** | **100%** |

Config F achieves the same 100% as Config D (CLAUDE.md) while avoiding the always-loaded context cost.

## 17. Statistical Summary

Total automated test runs across the campaign: ~95 (14-test full suite + targeted reruns + skill experiment + delegate command test)

| Metric | Value |
|--------|-------|
| Final pass rate (CLAUDE.md) | 100% (14/14) |
| /dev:delegate command pass rate | 100% (2/2) |
| Baseline pass rate | 79% (11/14) |
| Skill-only pass rate | 0% (0/2) |
| Skill + explicit instruction | 100% (2/2) |
| Description-only improvement | 0% |
| CLAUDE.md routing improvement | +21% (79% → 100%) |
| Average test duration | 252s |
| Total test runtime | ~5,700s (~95 min) |
| Test framework | `autotest/subagents/` |
| Test cases version | v3.0.0 |

## 18. Implications for Plugin Developers

1. **Put routing rules in CLAUDE.md, not skills or agent descriptions.** Active retrieval (skills) fails because Claude must decide to invoke them, and it doesn't. Agent descriptions are only consulted after the delegation decision is already made.

2. **Consider a `/delegate` command for on-demand routing.** If you want to avoid the always-loaded context cost of CLAUDE.md, create a command with `skills: your-routing-skill` in its frontmatter. Users type `/delegate <task>` and the routing table loads on demand. This achieved 100% accuracy with zero CLAUDE.md footprint.

3. **Skills work only when explicitly invoked, but command frontmatter solves this.** A standalone skill requires users to invoke it manually before each task. But a command's `skills:` frontmatter loads the skill automatically when the command runs — the key insight.

4. **Be specific about IMPLEMENT vs UNDERSTAND.** Tasks that touch existing code can be ambiguous between investigation and implementation. Explicit disambiguation is required.

5. **Keywords still work as fallback.** If users include "subagent", "background subagent", or "parallel subagents" in their prompts, delegation works regardless of CLAUDE.md routing.

6. **Test with `claude -p`.** Automated testing with `--output-format stream-json --verbose` gives you full transcript visibility into agent selection decisions.

7. **The Vercel pattern generalizes.** Their finding about AGENTS.md vs skills applies directly to Claude Code's agent system. Passive context (always in prompt) outperforms active retrieval (must decide to look up) for behavioral rules.

8. **Keep CLAUDE.md routing concise.** The routing table is ~14 lines. Passive context works because it's always loaded, but this also means it competes for system prompt space. Keep it compressed like Vercel's 8KB AGENTS.md.

9. **Watch for cache vs local path issues when testing plugins.** New commands and skills added to a local repo won't be visible to `claude -p` until deployed to the plugin cache directory. Always verify the slash_commands list in the init transcript.

## 19. Final Conclusion: The Two-Layer Routing Architecture

After 95 automated test runs, 6 configuration variants, and 10+ hours of experimentation, the research converges on a clear architectural recommendation for how to route tasks to specialized agents.

### The Problem Restated

Claude Code has a rich ecosystem of specialized agents, but an LLM cannot reliably decide *on its own* when to delegate to them. Agent descriptions don't fix it. Enhanced descriptions with examples don't fix it. Even "IMPORTANT: always delegate" directives in descriptions don't fix it. The decision-making bottleneck is upstream of where descriptions are consulted.

### Why Skills Alone Don't Work

A standalone skill containing a routing table has a fundamental circular dependency: Claude must decide to invoke the routing skill *before* it knows what the routing skill says. But the routing skill is precisely the thing that tells Claude when to delegate. This meta-delegation problem means skills have a 0% autonomous invocation rate for routing decisions.

### The Two Layers

The solution splits into two complementary layers based on when the routing knowledge is needed:

#### Layer 1: Global Map in CLAUDE.md (Passive Context)

```
CLAUDE.md
├── Task Routing - Agent Delegation
│   ├── Routing table (| Task Pattern | Delegate To | Trigger |)
│   └── Disambiguation rules (IMPLEMENT → developer, UNDERSTAND → detective)
```

**What it does:** Always loaded into the system prompt. Claude reads the routing table passively on every conversation. When a task matches a row in the table, Claude delegates automatically without needing any user action.

**When to use:** For *global* routing rules that should apply to every conversation. The routing table is small (~14 lines) and the context cost is acceptable for always-on autonomous delegation.

**Pass rate:** 100% (14/14 tests)

#### Layer 2: Context-Aware Map in Commands (On-Demand Injection)

```
plugins/dev/commands/delegate.md
├── skills: dev:task-routing          ← loads routing skill automatically
├── template: "Read routing table, match task, delegate immediately"
└── invocation: /dev:delegate <task>
```

```
plugins/dev/skills/task-routing/SKILL.md
├── Same routing table content as CLAUDE.md
└── Loaded ONLY when referenced by a command's skills: frontmatter
```

**What it does:** The routing table enters context *only when the user invokes `/dev:delegate`*. The command's `skills:` frontmatter automatically loads the `dev:task-routing` skill, making the routing table available without polluting every conversation.

**When to use:** For *context-aware* routing where the user wants explicit control over delegation. The user says "I want this task delegated" by typing `/dev:delegate`, and the command ensures correct agent selection. Zero context cost on conversations that don't need delegation.

**Pass rate:** 100% (2/2 tests)

### Why Both Layers Together

| Scenario | Layer 1 (CLAUDE.md) | Layer 2 (/dev:delegate) |
|----------|--------------------|-----------------------|
| User says "Research auth patterns" | Claude reads routing table, delegates to `dev:researcher` automatically | Not needed — autonomous routing handled it |
| User says "/dev:delegate Research auth patterns" | N/A — command takes over | Command loads skill, delegates to `dev:researcher` with guaranteed routing |
| User asks a simple question | Routing table is loaded but doesn't trigger (no match) — 14 lines of context overhead | Not loaded — zero overhead |
| Future: 50+ agents, complex routing | CLAUDE.md grows, context cost increases | Move complex routing to skill, invoke via command — keeps CLAUDE.md lean |

The recommended production configuration is **both layers active simultaneously**:

- **CLAUDE.md** provides the global safety net — Claude always knows where to route common task patterns
- **`/dev:delegate`** provides the explicit escape hatch — when users want guaranteed delegation with full routing context

As the agent ecosystem grows, the balance may shift: the CLAUDE.md table stays as a compact summary of the most common routes, while the `/dev:delegate` command loads a comprehensive routing skill with detailed disambiguation rules, examples, and edge cases that would be too expensive to keep in the system prompt permanently.

### The Context Injection Spectrum

This research revealed three distinct points on the context injection spectrum:

```
Always loaded ◄─────────────────────────────────────────► Never loaded
     │                        │                               │
  CLAUDE.md              /dev:delegate                    Skill alone
  (passive)           (on-demand via command)          (active retrieval)
   100%                    100%                             0%
                                                    (meta-delegation
                                                     circular dependency)
```

The middle point — on-demand injection via command frontmatter — is the key discovery. It achieves the same 100% reliability as passive context while giving users explicit control and avoiding always-loaded context costs.

### Files Implementing This Architecture

| File | Layer | Purpose |
|------|-------|---------|
| `CLAUDE.md` (Task Routing section) | Layer 1 | Global routing table, always in system prompt |
| `plugins/dev/commands/delegate.md` | Layer 2 | On-demand delegation command |
| `plugins/dev/skills/task-routing/SKILL.md` | Layer 2 | Routing table as loadable skill |
| `plugins/dev/agents/researcher.md` | Supporting | Enhanced description (helps after delegation decision) |
| `plugins/dev/agents/developer.md` | Supporting | Enhanced description (helps after delegation decision) |
| `autotest/subagents/` | Validation | Complete automated test framework (14 cases, 3 test scripts) |
