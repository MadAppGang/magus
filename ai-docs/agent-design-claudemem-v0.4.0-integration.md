# Claudemem v0.4.0 Feature Integration Design

**Version:** 1.1.0 [REVISED]
**Date:** December 23, 2025
**Author:** Agent Designer
**Plugin:** code-analysis
**Target Version:** v2.6.0
**Revision Date:** December 23, 2025
**Review Status:** CONDITIONAL APPROVAL - Revised based on 4-model review

---

## Revision Summary [REVISED]

This document has been updated based on consolidated feedback from 4 external AI models (Grok, Gemini Flash, Gemini Pro, DeepSeek). Key revisions:

| Section | Change | Priority |
|---------|--------|----------|
| NEW Section 1.4 | Version Compatibility Framework | CRITICAL |
| Section 3.1 | Empty result handling in all workflows | CRITICAL |
| Section 4.1 | Reduced orchestration coupling - references `orchestration:multi-model-validation` | HIGH |
| Section 6.x | All workflow templates updated with error handling | HIGH |
| NEW Section 10.5 | Static Analysis Limitations documentation | HIGH |
| NEW Section 4.3 | Session Lifecycle Management with TTL | HIGH |

---

## Executive Summary

This design document outlines the integration of comprehensive new claudemem features into the code-analysis plugin. The update introduces:

1. **Code Analysis Commands** - `dead-code`, `test-gaps`, `impact` for automated code quality analysis
2. **Multi-Agent Orchestration Patterns** - Parallel investigation with shared claudemem output
3. **LLM Enrichment Document Types** - Enhanced search with `--use-case` navigation mode
4. **Workflow Templates** - Standardized investigation patterns for common scenarios

**Impact Assessment:**
- **5 Detective Skills** - Major updates with new commands
- **1 Search Skill** - Extended with code analysis and orchestration sections
- **4 Hooks** - Updates for version detection and session cleanup
- **1 New Skill** - `claudemem-orchestration` for multi-agent patterns (references `orchestration:multi-model-validation`)
- **plugin.json** - Version bump to v2.6.0

---

## Table of Contents

1. [Current State Analysis](#1-current-state-analysis)
2. [Missing Features](#2-missing-features)
3. [Design: Code Analysis Commands](#3-design-code-analysis-commands)
4. [Design: Multi-Agent Orchestration](#4-design-multi-agent-orchestration)
5. [Design: LLM Enrichment Document Types](#5-design-llm-enrichment-document-types)
6. [Design: Workflow Templates](#6-design-workflow-templates)
7. [Files to Create/Modify](#7-files-to-createmodify)
8. [Implementation Sequence](#8-implementation-sequence)
9. [Testing Strategy](#9-testing-strategy)
10. [Risk Assessment](#10-risk-assessment)

---

## 1. Current State Analysis

### 1.1 Plugin Structure (v2.5.0)

```
plugins/code-analysis/
├── plugin.json                    # v2.5.0 manifest
├── agents/
│   └── codebase-detective.md      # Main investigation agent
├── commands/
│   ├── analyze.md                 # /analyze command
│   ├── help.md                    # /help command
│   └── setup.md                   # /setup command
├── skills/
│   ├── deep-analysis/             # General analysis skill
│   ├── claudemem-search/          # Core claudemem documentation (v0.3.0)
│   ├── claudish-usage/            # Claudish CLI usage
│   ├── code-search-selector/      # Tool selection decision tree
│   ├── search-interceptor/        # Multi-file read detection
│   ├── architect-detective/       # Architecture investigation (v3.0.0)
│   ├── developer-detective/       # Implementation investigation (v3.0.0)
│   ├── tester-detective/          # Test coverage investigation (v3.0.0)
│   ├── debugger-detective/        # Bug investigation (v3.0.0)
│   ├── ultrathink-detective/      # Comprehensive investigation (v3.0.0)
│   └── cross-plugin-detective/    # Cross-plugin integration
└── hooks/
    ├── session-start.sh           # Claudemem status check
    ├── intercept-grep.sh          # Replace Grep with claudemem
    ├── intercept-bash.sh          # Replace bash grep/rg/find
    ├── intercept-glob.sh          # Warn on broad patterns
    └── intercept-read.sh          # Warn on sequential reads
```

### 1.2 Current Claudemem Commands (v0.3.0)

| Command | Purpose | Primary Skill |
|---------|---------|---------------|
| `map [query]` | Structural overview with PageRank | architect-detective |
| `symbol <name>` | Exact file:line location | all detectives |
| `callers <name>` | What calls this symbol | developer, tester |
| `callees <name>` | What this symbol calls | developer, debugger |
| `context <name>` | Full call chain | debugger, ultrathink |
| `search <query>` | Semantic search | ultrathink |

### 1.3 Detective Skills Pattern

Each detective skill follows this structure:

```markdown
---
name: {role}-detective
description: "PRIMARY TOOL for: {keywords}. Uses claudemem v0.3.0..."
allowed-tools: Bash, Task, Read, AskUserQuestion
---

# CRITICAL: AST STRUCTURAL ANALYSIS ONLY
# FORBIDDEN: grep, find, glob

# Role Context (what perspective)
# Why {primary_command} is Perfect (justification)
# {Role}-Focused Commands (command examples)
# Workflow: {Investigation Type} (step-by-step)
# Output Format: {Report Type} (structured output)
# Scenarios (2-4 examples)
# Anti-Patterns (table)
# Notes (tips)
```

### 1.4 Version Compatibility Framework [REVISED - NEW SECTION]

**Badge Requirements:**

All sections documenting v0.4.0 features MUST include version badges:

```markdown
### Feature Name (v0.4.0+ Required)
```

**Version Detection:**

The `session-start.sh` hook must detect claudemem version and warn appropriately:

```bash
#!/bin/bash
# Claudemem version detection

CLAUDEMEM_VERSION=$(claudemem --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)

if [[ -z "$CLAUDEMEM_VERSION" ]]; then
  echo "WARNING: claudemem not found or not installed"
  echo "Install: npm install -g claude-codemem"
  exit 0
fi

# Compare versions (semantic versioning)
version_gte() {
  printf '%s\n%s' "$1" "$2" | sort -V -C
}

if ! version_gte "0.4.0" "$CLAUDEMEM_VERSION"; then
  echo "NOTE: claudemem v$CLAUDEMEM_VERSION installed"
  echo "      v0.4.0+ required for: dead-code, test-gaps, impact commands"
  echo "      Upgrade: npm update -g claude-codemem"
  echo ""
  echo "Available commands (v0.3.0):"
  echo "  - map, symbol, callers, callees, context, search"
else
  echo "claudemem v$CLAUDEMEM_VERSION (v0.4.0+ features available)"
  echo "Available commands:"
  echo "  - v0.3.0: map, symbol, callers, callees, context, search"
  echo "  - v0.4.0: dead-code, test-gaps, impact"
fi
```

**Graceful Degradation:**

When v0.4.0 commands are unavailable, detective skills should:

1. **Detect** - Check version before using new commands
2. **Fallback** - Use v0.3.0 equivalents where possible
3. **Document** - Note limitations in output

| v0.4.0 Command | Fallback (v0.3.0) | Limitations |
|----------------|-------------------|-------------|
| `dead-code` | `map` + manual PageRank filter | No automatic zero-caller detection |
| `test-gaps` | `callers` + manual test file check | Manual identification of test files |
| `impact` | `callers` (recursive, manual) | Single level only, no BFS traversal |

---

## 2. Missing Features

### 2.1 Code Analysis Commands (NEW in claudemem v0.4.0)

| Command | Purpose | Algorithm | Best For |
|---------|---------|-----------|----------|
| `dead-code` | Find unused symbols | Zero callers + low PageRank | architect, developer |
| `test-gaps` | Find untested high-importance code | High PageRank + zero test callers | tester |
| `impact <symbol>` | BFS traversal of transitive callers | Depth-limited BFS | all detectives |

**Current Gap:** These commands are not documented in any skill or used in detective workflows.

### 2.2 Multi-Agent Orchestration Patterns

**Pattern 1: Parallel Analysis with Shared Output**
- Run claudemem once, share output file across parallel agents
- Reduces redundant claudemem calls
- Enables consensus-based analysis

**Role-Based Command Mapping**
| Agent Role | Primary Commands | Focus |
|------------|------------------|-------|
| Architect | `map`, `context`, `dead-code` | Structure, patterns, cleanup |
| Developer | `symbol`, `callers`, `callees`, `impact` | Modification scope |
| Tester | `test-gaps`, `callers` | Coverage priorities |
| Debugger | `symbol`, `context`, `impact` | Error tracing |

**Current Gap:** Multi-agent patterns are in orchestration plugin but not integrated into detective skills.

### 2.3 LLM Enrichment Document Types

| Document Type | Purpose | Search Weight |
|---------------|---------|---------------|
| `symbol_summary` | Function behavior, params, returns, side effects | Navigation |
| `file_summary` | File purpose, exports, architectural patterns | Navigation |
| `idiom` | Common patterns in codebase | Understanding |
| `usage_example` | How to use APIs | Learning |
| `anti_pattern` | What NOT to do | Prevention |
| `project_doc` | Project-level documentation | Context |

**Navigation Mode:** `claudemem --agent search "query" --use-case navigation`

**Current Gap:** Document types and `--use-case` flag not documented in claudemem-search skill.

### 2.4 Workflow Templates

| Template | Steps | Primary Commands |
|----------|-------|------------------|
| Bug Investigation | Locate symptom, trace callers, find root cause | `symbol`, `callers`, `context`, `impact` |
| New Feature | Map area, find patterns, trace dependencies | `map`, `callees`, `context` |
| Refactoring | Find symbol, get all callers, update systematically | `symbol`, `impact`, `callers` |
| Architecture Understanding | Map structure, identify pillars, trace flows | `map`, `context`, `dead-code` |

**Current Gap:** Templates exist as scenarios in skills but not as standardized, reusable patterns.

---

## 3. Design: Code Analysis Commands

### 3.1 Update claudemem-search Skill [REVISED - Empty Result Handling Added]

Add new section after "Command Reference":

```markdown
---

## Code Analysis Commands (v0.4.0+ Required) [REVISED]

### claudemem dead-code

Find unused symbols in the codebase.

```bash
# Find all unused symbols
claudemem --agent dead-code
# Stricter threshold (only very low PageRank)
claudemem --agent dead-code --max-pagerank 0.005
# Include exported symbols (usually excluded)
claudemem --agent dead-code --include-exported```

**Algorithm:**
- Zero callers (nothing references the symbol)
- Low PageRank (< 0.001 default)
- Not exported (by default, exports may be used externally)

**Output fields**: file, line, kind, name, pagerank, last_caller_removed

**When to use**: Architecture cleanup, tech debt assessment, before major refactoring

**Empty Result Handling:** [REVISED]
```bash
RESULT=$(claudemem --agent dead-code)
if [ -z "$RESULT" ] || [ "$RESULT" = "No dead code found" ]; then
  echo "Codebase is clean - no dead code detected!"
  echo "This indicates good code hygiene."
else
  echo "$RESULT"
fi
```

**Static Analysis Limitations:** [REVISED]
- Dynamic imports (`import()`) may hide real callers
- Reflection-based access not captured
- External callers (other repos, CLI usage) not visible
- Exported symbols excluded by default for this reason

### claudemem test-gaps

Find high-importance code without test coverage.

```bash
# Find all test coverage gaps
claudemem --agent test-gaps
# Only critical gaps (high PageRank)
claudemem --agent test-gaps --min-pagerank 0.05```

**Algorithm:**
- High PageRank (> 0.01 default) - Important code
- Zero callers from test files (*.test.ts, *.spec.ts, *_test.go)

**Output fields**: file, line, kind, name, pagerank, production_callers, test_callers

**When to use**: Test coverage analysis, QA planning, identifying critical gaps

**Empty Result Handling:** [REVISED]
```bash
RESULT=$(claudemem --agent test-gaps)
if [ -z "$RESULT" ] || [ "$RESULT" = "No test gaps found" ]; then
  echo "Excellent! All high-importance code has test coverage."
  echo "Consider lowering --min-pagerank threshold for additional coverage."
else
  echo "$RESULT"
fi
```

**Static Analysis Limitations:** [REVISED]
- Test file detection based on naming patterns only
- Integration tests calling code indirectly may not be detected
- Mocked dependencies may show false positives

### claudemem impact <symbol>

Analyze the impact of changing a symbol using BFS traversal.

```bash
# Get all transitive callers
claudemem --agent impact UserService
# Limit depth for large codebases
claudemem --agent impact UserService --max-depth 5```

**Algorithm:**
- BFS traversal from symbol to all transitive callers
- Groups results by depth level
- Shows file:line for each caller

**Output sections**: direct_callers, transitive_callers (with depth), grouped_by_file

**When to use**: Before ANY modification, refactoring planning, risk assessment

**Empty Result Handling:** [REVISED]
```bash
RESULT=$(claudemem --agent impact FunctionName)
if [ -z "$RESULT" ] || echo "$RESULT" | grep -q "No callers found"; then
  echo "No callers found - this symbol appears unused or is an entry point."
  echo "If unused, consider running: claudemem --agent dead-code"
  echo "If entry point (API handler, main), this is expected."
else
  echo "$RESULT"
fi
```

**Static Analysis Limitations:** [REVISED]
- Callback/event-based calls may not be detected
- Dependency injection containers hide static call relationships
- External service callers not visible

---
```

### 3.2 Update Detective Skills

#### 3.2.1 architect-detective (add dead-code)

Add to "Architect-Focused Commands (v0.3.0)" section:

```markdown
### Dead Code Detection (v0.4.0+ Required) [REVISED]

```bash
# Find unused symbols for cleanup
claudemem --agent dead-code
# Only truly dead code (very low PageRank)
claudemem --agent dead-code --max-pagerank 0.005```

**Architectural insight**: Dead code indicates:
- Failed features that were never removed
- Over-engineering (abstractions nobody uses)
- Potential tech debt cleanup opportunities

High PageRank + dead = Something broke recently (investigate!)
Low PageRank + dead = Safe to remove

**Handling Results:** [REVISED]
```bash
DEAD_CODE=$(claudemem --agent dead-code)
if [ -z "$DEAD_CODE" ]; then
  echo "No dead code found - architecture is well-maintained"
else
  # Categorize by risk
  HIGH_PAGERANK=$(echo "$DEAD_CODE" | awk '$5 > 0.01')
  LOW_PAGERANK=$(echo "$DEAD_CODE" | awk '$5 <= 0.01')

  if [ -n "$HIGH_PAGERANK" ]; then
    echo "WARNING: High-PageRank dead code found (possible broken references)"
    echo "$HIGH_PAGERANK"
  fi

  if [ -n "$LOW_PAGERANK" ]; then
    echo "Cleanup candidates (low PageRank):"
    echo "$LOW_PAGERANK"
  fi
fi
```

**Limitations Note:** [REVISED]
Results labeled "Potentially Dead" require manual verification for:
- Dynamically imported modules
- Reflection-accessed code
- External API consumers
```

Add to "Workflow: Architecture Analysis (v0.3.0)" after Phase 4:

```markdown
### Phase 5: Cleanup Opportunities (v0.4.0+ Required) [REVISED]

```bash
# Find dead code
DEAD_CODE=$(claudemem --agent dead-code)

if [ -z "$DEAD_CODE" ]; then
  echo "No cleanup needed - codebase is well-maintained"
else
  # For each dead symbol:
  # - Check PageRank (low = utility, high = broken)
  # - Verify not used externally (see limitations)
  # - Add to cleanup backlog

  echo "Review each item for static analysis limitations:"
  echo "- Dynamic imports may hide real usage"
  echo "- External callers not visible to static analysis"
fi
```
```

#### 3.2.2 developer-detective (add impact)

Add to "Developer-Focused Commands (v0.3.0)" section:

```markdown
### Impact Analysis (v0.4.0+ Required) [REVISED]

```bash
# Before modifying ANY code, check full impact
claudemem --agent impact functionToChange
# Output shows ALL transitive callers:
# direct_callers:
#   - LoginController.authenticate:34
#   - SessionMiddleware.validate:12
# transitive_callers (depth 2):
#   - AppRouter.handleRequest:45
#   - TestSuite.runAuth:89
```

**Why impact matters**:
- `callers` shows only direct callers (1 level)
- `impact` shows ALL transitive callers (full tree)
- Critical for refactoring decisions

**Handling Empty Results:** [REVISED]
```bash
IMPACT=$(claudemem --agent impact functionToChange)
if echo "$IMPACT" | grep -q "No callers"; then
  echo "No callers found. This is either:"
  echo "  1. An entry point (API handler, main function) - expected"
  echo "  2. Dead code - verify with: claudemem dead-code"
  echo "  3. Dynamically called - check for import(), reflection"
fi
```
```

Update "Impact Analysis (BEFORE Modifying)" section:

```markdown
### Impact Analysis (BEFORE Modifying) [REVISED]

```bash
# Quick check - direct callers only (v0.3.0)
claudemem --agent callers functionToChange
# Deep check - ALL transitive callers (v0.4.0+ Required)
IMPACT=$(claudemem --agent impact functionToChange)

# Handle results
if [ -z "$IMPACT" ] || echo "$IMPACT" | grep -q "No callers"; then
  echo "No static callers found - verify dynamic usage patterns"
else
  echo "$IMPACT"
  echo ""
  echo "This tells you:"
  echo "- Direct callers (immediate impact)"
  echo "- Transitive callers (ripple effects)"
  echo "- Grouped by file (for systematic updates)"
fi
```
```

#### 3.2.3 tester-detective (add test-gaps)

Add to "Tester-Focused Commands (v0.3.0)" section:

```markdown
### Test Coverage Gaps (v0.4.0+ Required) [REVISED]

```bash
# Find high-importance untested code automatically
claudemem --agent test-gaps
# Output:
# file: src/services/payment.ts
# line: 45-89
# name: processPayment
# pagerank: 0.034
# production_callers: 4
# test_callers: 0
# ---
# This is CRITICAL - high PageRank but no tests!
```

**Why test-gaps is better than manual analysis**:
- Automatically finds high-PageRank symbols
- Automatically counts test vs production callers
- Prioritized list of coverage gaps

**Handling Empty Results:** [REVISED]
```bash
GAPS=$(claudemem --agent test-gaps)
if [ -z "$GAPS" ] || echo "$GAPS" | grep -q "No test gaps"; then
  echo "Excellent test coverage! All high-importance code has tests."
  echo ""
  echo "Optional: Check lower-importance code:"
  echo "  claudemem --agent test-gaps --min-pagerank 0.005"
else
  echo "Test Coverage Gaps Found:"
  echo "$GAPS"
fi
```

**Limitations Note:** [REVISED]
Test detection relies on file naming patterns:
- `*.test.ts`, `*.spec.ts`, `*_test.go`, etc.
- Integration tests in non-standard locations may not be detected
- Manual test files require naming convention updates
```

Replace "Find Untested Code" section:

```markdown
### Find Untested Code [REVISED]

**Method 1: Automated (v0.4.0+ Required - Recommended)**

```bash
# Let claudemem find all gaps automatically
GAPS=$(claudemem --agent test-gaps)

if [ -z "$GAPS" ]; then
  echo "No high-importance untested code found!"
else
  echo "$GAPS"
fi

# Focus on critical gaps only
claudemem --agent test-gaps --min-pagerank 0.05```

**Method 2: Manual (for specific functions, v0.3.0 compatible)**

```bash
# Get callers for a function
claudemem --agent callers importantFunction
# If NO callers from *.test.ts or *.spec.ts files:
# This function has NO tests!
```
```

Update "Workflow: Test Coverage Analysis" to add Phase 0:

```markdown
### Phase 0: Automated Gap Detection (v0.4.0+ Required) [REVISED]

```bash
# Run test-gaps FIRST - it does the work for you
GAPS=$(claudemem --agent test-gaps)

if [ -z "$GAPS" ]; then
  echo "No gaps found at default threshold"
  echo "Optionally check with lower threshold:"
  claudemem --agent test-gaps --min-pagerank 0.005else
  # This gives you a prioritized list of:
  # - High-PageRank symbols
  # - With 0 test callers
  # - Sorted by importance
  echo "$GAPS"
fi
```
```

#### 3.2.4 debugger-detective (add impact)

Add to "Debugger-Focused Commands (v0.3.0)" section:

```markdown
### Blast Radius Analysis (v0.4.0+ Required) [REVISED]

```bash
# After finding the bug, check what else is affected
IMPACT=$(claudemem --agent impact buggyFunction)

if [ -z "$IMPACT" ] || echo "$IMPACT" | grep -q "No callers"; then
  echo "No static callers - bug is isolated (or dynamically called)"
else
  echo "$IMPACT"
  echo ""
  echo "This shows:"
  echo "- Direct callers (immediately affected)"
  echo "- Transitive callers (potentially affected)"
  echo "- Complete list for testing after fix"
fi
```

**Use for**:
- Post-fix verification (test all impacted code)
- Regression prevention (know what to test)
- Incident documentation (impact scope)

**Limitations:** [REVISED]
Event-driven/callback architectures may have callers not visible to static analysis.
```

#### 3.2.5 ultrathink-detective (add all three)

Add new section after "Dimension 6: Performance":

```markdown
### Dimension 7: Code Health (v0.4.0+ Required) [REVISED]

```bash
# Dead code detection
DEAD=$(claudemem --agent dead-code)

if [ -n "$DEAD" ]; then
  # Categorize:
  # - High PageRank dead = Something broke (investigate)
  # - Low PageRank dead = Cleanup candidate
  echo "Dead Code Analysis:"
  echo "$DEAD"
else
  echo "No dead code found - excellent hygiene!"
fi

# Test coverage gaps
GAPS=$(claudemem --agent test-gaps)

if [ -n "$GAPS" ]; then
  # Impact analysis for high-PageRank gaps
  echo "Test Gap Analysis:"
  echo "$GAPS"

  # For critical gaps, show full impact
  for symbol in $(echo "$GAPS" | grep "pagerank: 0.0[5-9]" | awk '{print $4}'); do
    echo "Impact for critical untested: $symbol"
    claudemem --agent impact "$symbol"  done
else
  echo "No test gaps found - excellent coverage!"
fi
```
```

Update Executive Summary output format:

```markdown
|  Dimensions:                                                     |
|  ├── Architecture:    GOOD      (8/10) [map analysis]            |
|  ├── Implementation:  MODERATE  (7/10) [callers/callees]         |
|  ├── Testing:         POOR      (5/10) [test-gaps]               |
|  ├── Reliability:     GOOD      (8/10) [context tracing]         |
|  ├── Security:        MODERATE  (7/10) [auth callers]            |
|  ├── Performance:     GOOD      (8/10) [async patterns]          |
|  └── Code Health:     MODERATE  (6/10) [dead-code + impact]      |
```

---

## 4. Design: Multi-Agent Orchestration [REVISED - Reduced Coupling]

### 4.1 Create New Skill: claudemem-orchestration [REVISED]

**Location:** `plugins/code-analysis/skills/claudemem-orchestration/SKILL.md`

**Key Change:** This skill references `orchestration:multi-model-validation` for parallel execution patterns instead of duplicating that knowledge. It focuses ONLY on claudemem-specific patterns.

```markdown
---
name: claudemem-orchestration
description: "Multi-agent code analysis orchestration using claudemem. Share claudemem output across parallel agents. Enables parallel investigation, consensus analysis, and role-based command mapping."
allowed-tools: Bash, Task, Read, Write, AskUserQuestion
skills: orchestration:multi-model-validation
---

# Claudemem Multi-Agent Orchestration

**Version:** 1.0.0 [REVISED]
**Purpose:** Coordinate multiple agents using shared claudemem output

## Overview

When multiple agents need to investigate the same codebase:
1. **Run claudemem ONCE** to get structural overview
2. **Write output to shared file** in session directory
3. **Launch agents in parallel** - all read the same file
4. **Consolidate results** with consensus analysis

This pattern avoids redundant claudemem calls and enables consensus-based prioritization.

**For parallel execution patterns, see:** `orchestration:multi-model-validation` skill

## Claudemem-Specific Patterns [REVISED]

This skill focuses on claudemem-specific orchestration. For general parallel execution:
- **4-Message Pattern** - See `orchestration:multi-model-validation` Pattern 1
- **Session Setup** - See `orchestration:multi-model-validation` Pattern 0
- **Statistics Collection** - See `orchestration:multi-model-validation` Pattern 7

### Pattern 1: Shared Claudemem Output

**Purpose:** Run expensive claudemem commands ONCE, share results across agents.

```bash
# Create unique session directory (per orchestration:multi-model-validation Pattern 0)
SESSION_ID="analysis-$(date +%Y%m%d-%H%M%S)-$(head -c 4 /dev/urandom | xxd -p)"
SESSION_DIR="/tmp/${SESSION_ID}"
mkdir -p "$SESSION_DIR"

# Run claudemem ONCE, write to shared files
claudemem --agent map "feature area" > "$SESSION_DIR/structure-map.md"
claudemem --agent test-gaps > "$SESSION_DIR/test-gaps.md" 2>&1 || echo "No gaps found" > "$SESSION_DIR/test-gaps.md"
claudemem --agent dead-code > "$SESSION_DIR/dead-code.md" 2>&1 || echo "No dead code" > "$SESSION_DIR/dead-code.md"

# Export session info
echo "$SESSION_ID" > "$SESSION_DIR/session-id.txt"
```

**Why shared output matters:**
- Claudemem indexing is expensive (full AST parse)
- Same index serves all queries in session
- Parallel agents reading same file = no redundant computation

### Pattern 2: Role-Based Agent Distribution

After running claudemem, distribute to role-specific agents:

```
# Parallel Execution (ONLY Task calls - per 4-Message Pattern)
Task: architect-detective
  Prompt: "Analyze architecture from $SESSION_DIR/structure-map.md.
           Focus on layer boundaries and design patterns.
           Write findings to $SESSION_DIR/architect-analysis.md"
---
Task: tester-detective
  Prompt: "Analyze test gaps from $SESSION_DIR/test-gaps.md.
           Prioritize coverage recommendations.
           Write findings to $SESSION_DIR/tester-analysis.md"
---
Task: developer-detective
  Prompt: "Analyze dead code from $SESSION_DIR/dead-code.md.
           Identify cleanup opportunities.
           Write findings to $SESSION_DIR/developer-analysis.md"

All 3 execute simultaneously (3x speedup!)
```

### Pattern 3: Consolidation with Ultrathink

```
Task: ultrathink-detective
  Prompt: "Consolidate analyses from:
           - $SESSION_DIR/architect-analysis.md
           - $SESSION_DIR/tester-analysis.md
           - $SESSION_DIR/developer-analysis.md

           Create unified report with prioritized action items.
           Write to $SESSION_DIR/consolidated-analysis.md"
```

## Role-Based Command Mapping

| Agent Role | Primary Commands | Secondary Commands | Focus |
|------------|------------------|-------------------|-------|
| Architect | `map`, `dead-code` | `context` | Structure, cleanup |
| Developer | `callers`, `callees`, `impact` | `symbol` | Modification scope |
| Tester | `test-gaps` | `callers` | Coverage priorities |
| Debugger | `context`, `impact` | `symbol`, `callers` | Error tracing |
| Ultrathink | ALL | ALL | Comprehensive |

## Sequential Investigation Flow

For complex bugs or features requiring ordered investigation:

```
Phase 1: Architecture Understanding
  claudemem --agent map "problem area"  Identify high-PageRank symbols (> 0.05)

Phase 2: Symbol Deep Dive
  For each high-PageRank symbol:
    claudemem --agent context <symbol>    Document dependencies and callers

Phase 3: Impact Assessment (v0.4.0+)
  claudemem --agent impact <primary-symbol>  Document full blast radius

Phase 4: Gap Analysis (v0.4.0+)
  claudemem --agent test-gaps --min-pagerank 0.01  Identify coverage holes in affected code

Phase 5: Action Planning
  Prioritize by: PageRank * impact_depth * test_coverage
```

## Agent System Prompt Integration

When an agent needs deep code analysis, it should reference the claudemem skill:

```yaml
---
skills: code-analysis:claudemem-search, code-analysis:claudemem-orchestration
---
```

The agent then follows this pattern:

1. **Check claudemem status**: `claudemem status`
2. **Index if needed**: `claudemem index`
3. **Run appropriate command** based on role
4. **Write results to session file** for sharing
5. **Return brief summary** to orchestrator

## Best Practices

**Do:**
- Run claudemem ONCE per investigation type
- Write all output to session directory
- Use parallel execution for independent analyses (see `orchestration:multi-model-validation`)
- Consolidate with ultrathink for cross-perspective insights
- Handle empty results gracefully

**Don't:**
- Run same claudemem command multiple times
- Let each agent run its own claudemem (wasteful)
- Skip the consolidation step
- Forget to clean up session directory (see Session Lifecycle)

---

**Maintained by:** MadAppGang
**Plugin:** code-analysis v2.6.0
**Last Updated:** December 2025
```

### 4.2 Update plugin.json

Add the new skill:

```json
{
  "skills": [
    "./skills/deep-analysis",
    "./skills/claudemem-search",
    "./skills/claudemem-orchestration",  // NEW
    "./skills/claudish-usage",
    ...
  ]
}
```

### 4.3 Session Lifecycle Management [REVISED - NEW SECTION]

**Problem:** Session directories accumulate in `/tmp`, causing disk bloat.

**Solution:** TTL-based cleanup enforced by hooks.

**Add to session-start.sh:**

```bash
#!/bin/bash
# Session lifecycle management

# Clean up old sessions (older than 1 day)
cleanup_old_sessions() {
  find /tmp -maxdepth 1 -name "analysis-*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null
  find /tmp -maxdepth 1 -name "plan-review-*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null
  find /tmp -maxdepth 1 -name "review-*" -type d -mtime +1 -exec rm -rf {} + 2>/dev/null
}

# Run cleanup at session start
cleanup_old_sessions

# Report cleanup
CLEANED=$(find /tmp -maxdepth 1 -name "*-202*" -type d -mtime +1 2>/dev/null | wc -l)
if [ "$CLEANED" -gt 0 ]; then
  echo "Cleaned up $CLEANED old session directories"
fi
```

**Session Cleanup Options:**

```bash
# Option 1: Automatic cleanup after investigation (recommended)
# Add to end of orchestration workflow
rm -rf "$SESSION_DIR"

# Option 2: Preserve for audit trail
# Move to ai-docs for persistence
mv "$SESSION_DIR" ai-docs/investigation-${SESSION_ID}/

# Option 3: Manual cleanup
# User runs when needed
find /tmp -name "analysis-*" -mtime +1 -exec rm -rf {} +
```

---

## 5. Design: LLM Enrichment Document Types

### 5.1 Update claudemem-search Skill

Add new section after "Command Reference":

```markdown
---

## LLM Enrichment Document Types (v0.2.0+)

Claudemem v0.2.0+ supports **LLM-enriched semantic search** with specialized document types.

### Document Types

| Type | Purpose | Generated By |
|------|---------|--------------|
| `symbol_summary` | Function behavior, params, returns, side effects | LLM analysis |
| `file_summary` | File purpose, exports, architectural patterns | LLM analysis |
| `idiom` | Common patterns in codebase | Pattern detection |
| `usage_example` | How to use APIs | Documentation extraction |
| `anti_pattern` | What NOT to do | Static analysis + LLM |
| `project_doc` | Project-level documentation | README, CLAUDE.md |

### Navigation Mode

For agent-optimized search with document type weighting:

```bash
# Navigation-focused search (prioritizes summaries)
claudemem --agent search "authentication" --use-case navigation
# Default search (balanced)
claudemem --agent search "authentication"```

**Navigation mode search weights:**
- `symbol_summary`: 1.5x (higher priority)
- `file_summary`: 1.3x (higher priority)
- `code_chunk`: 1.0x (normal)
- `idiom`: 1.2x (higher for pattern discovery)

### Symbol Summary Fields

```yaml
symbol: AuthService.authenticate
file: src/services/auth.ts
line: 45-89
behavior: "Validates user credentials and generates JWT token"
params:
  - name: credentials
    type: LoginCredentials
    description: "Email and password from login form"
returns:
  type: AuthResult
  description: "JWT token and user profile on success, error on failure"
side_effects:
  - "Updates user.lastLogin timestamp"
  - "Logs authentication attempt"
  - "May trigger rate limiting"
```

### File Summary Fields

```yaml
file: src/services/auth.ts
purpose: "Core authentication service handling login, logout, and session management"
exports:
  - AuthService (class)
  - authenticate (function)
  - validateToken (function)
patterns:
  - "Dependency Injection (constructor takes IUserRepository)"
  - "Factory Pattern (createSession)"
  - "Strategy Pattern (IAuthProvider interface)"
dependencies:
  - bcrypt (password hashing)
  - jsonwebtoken (JWT generation)
  - UserRepository (user data access)
```

### Using Document Types in Investigation

```bash
# Find function behavior without reading code
claudemem --agent search "processPayment behavior" --use-case navigation
# Output includes symbol_summary:
# symbol: PaymentService.processPayment
# behavior: "Charges customer card via Stripe and saves transaction"
# side_effects: ["Updates balance", "Sends receipt email", "Logs to audit"]

# Find file purposes for architecture understanding
claudemem --agent search "file:services purpose" --use-case navigation
# Find anti-patterns to avoid
claudemem --agent search "anti_pattern SQL"```

### Regenerating Enrichments

If codebase changes significantly:

```bash
# Re-index with LLM enrichment
claudemem index --enrich

# Or enrich specific files
claudemem enrich src/services/payment.ts
```

---
```

---

## 6. Design: Workflow Templates [REVISED - All Templates Have Error Handling]

### 6.1 Update claudemem-search Skill

Add new section "Workflow Templates":

```markdown
---

## Workflow Templates [REVISED]

Standardized investigation patterns for common scenarios. All templates include error handling for empty results and version compatibility checks.

### Template 1: Bug Investigation

**Trigger:** "Why is X broken?", "Find bug", "Root cause"

```bash
# Step 1: Locate the symptom
SYMBOL=$(claudemem --agent symbol FunctionFromStackTrace)
if [ -z "$SYMBOL" ]; then
  echo "Symbol not found - check spelling or run: claudemem --agent map 'related keywords'"
  exit 1
fi

# Step 2: Get full context (callers + callees)
claudemem --agent context FunctionFromStackTrace
# Step 3: Trace backwards to find root cause
claudemem --agent callers suspectedSource
# Step 4: Check full impact of the bug (v0.4.0+)
IMPACT=$(claudemem --agent impact BuggyFunction 2>/dev/null)
if [ -n "$IMPACT" ]; then
  echo "$IMPACT"
else
  echo "Impact analysis requires claudemem v0.4.0+ or no callers found"
  echo "Fallback: claudemem --agent callers BuggyFunction"
fi

# Step 5: Read identified file:line ranges
# Fix bug, verify callers still work

# Step 6: Document impacted code for testing
```

**Output Template:**

```markdown
## Bug Investigation Report

**Symptom:** [Description]
**Root Cause:** [Location and explanation]
**Call Chain:** [How we got here]
**Impact Radius:** [What else is affected]
**Fix Applied:** [What was changed]
**Verification:** [Tests run, callers checked]
```

### Template 2: New Feature Implementation

**Trigger:** "Add feature", "Implement X", "Extend functionality"

```bash
# Step 1: Map the feature area
MAP=$(claudemem --agent map "feature area keywords")
if [ -z "$MAP" ]; then
  echo "No matches found - try broader keywords"
fi

# Step 2: Identify extension points
claudemem --agent callees ExistingFeature
# Step 3: Get full context for modification point
claudemem --agent context ModificationPoint
# Step 4: Check existing patterns to follow
claudemem --agent search "similar pattern" --use-case navigation
# Step 5: Implement following existing patterns

# Step 6: Check test coverage gaps (v0.4.0+)
GAPS=$(claudemem --agent test-gaps 2>/dev/null)
if [ -n "$GAPS" ]; then
  echo "Test gaps to address:"
  echo "$GAPS"
else
  echo "test-gaps requires v0.4.0+ or no gaps found"
fi
```

**Output Template:**

```markdown
## Feature Implementation Plan

**Feature:** [Description]
**Extension Point:** [Where to add]
**Dependencies:** [What it needs]
**Pattern to Follow:** [Existing similar code]
**Test Requirements:** [Coverage needs]
```

### Template 3: Refactoring

**Trigger:** "Rename X", "Extract function", "Move code", "Refactor"

```bash
# Step 1: Find the symbol to refactor
SYMBOL=$(claudemem --agent symbol SymbolToRename)
if [ -z "$SYMBOL" ]; then
  echo "Symbol not found - check exact name"
  exit 1
fi

# Step 2: Get FULL impact (all transitive callers) (v0.4.0+)
IMPACT=$(claudemem --agent impact SymbolToRename 2>/dev/null)
if [ -n "$IMPACT" ]; then
  echo "$IMPACT"
  # (impact output includes grouped_by_file)
else
  echo "Using fallback (direct callers only):"
  claudemem --agent callers SymbolToRenamefi

# Step 3: Group by file for systematic updates

# Step 4: Update each caller location systematically

# Step 5: Verify all callers updated
claudemem --agent callers NewSymbolName
# Step 6: Run affected tests
```

**Output Template:**

```markdown
## Refactoring Report

**Original:** [Old name/location]
**Target:** [New name/location]
**Direct Callers:** [Count]
**Transitive Callers:** [Count]
**Files Modified:** [List]
**Verification:** [All callers updated, tests pass]
```

### Template 4: Architecture Understanding

**Trigger:** "How does X work?", "Explain architecture", "Onboarding"

```bash
# Step 1: Get full structural map
MAP=$(claudemem --agent map)
if [ -z "$MAP" ]; then
  echo "Index may be empty - run: claudemem index"
  exit 1
fi
echo "$MAP"

# Step 2: Identify architectural pillars (PageRank > 0.05)
# Document top 5 by PageRank

# Step 3: For each pillar, get full context
claudemem --agent context PillarSymbol
# Step 4: Trace major flows via callees
claudemem --agent callees EntryPoint
# Step 5: Identify dead code (cleanup opportunities) (v0.4.0+)
DEAD=$(claudemem --agent dead-code 2>/dev/null)
if [ -n "$DEAD" ]; then
  echo "Dead code found:"
  echo "$DEAD"
else
  echo "No dead code found (or v0.4.0+ required)"
fi

# Step 6: Identify test gaps (risk areas) (v0.4.0+)
GAPS=$(claudemem --agent test-gaps 2>/dev/null)
if [ -n "$GAPS" ]; then
  echo "Test gaps:"
  echo "$GAPS"
else
  echo "No test gaps found (or v0.4.0+ required)"
fi
```

**Output Template:**

```markdown
## Architecture Report

**Core Abstractions (PageRank > 0.05):**
1. [Symbol] - [Role in system]
2. [Symbol] - [Role in system]
3. [Symbol] - [Role in system]

**Layer Structure:**
```
[Presentation Layer]
      |
[Business Layer]
      |
[Data Layer]
```

**Major Flows:**
- [Flow 1: Entry -> Processing -> Output]
- [Flow 2: Entry -> Processing -> Output]

**Health Indicators:**
- Dead Code: [Count] symbols
- Test Gaps: [Count] high-importance untested
- Tech Debt: [Summary]
```

### Template 5: Security Audit

**Trigger:** "Security review", "Audit authentication", "Check permissions"

```bash
# Step 1: Map security-related code
claudemem --agent map "auth permission security token"
# Step 2: Find authentication entry points
SYMBOL=$(claudemem --agent symbol authenticate)
if [ -z "$SYMBOL" ]; then
  echo "No 'authenticate' symbol - try: login, verify, validate"
fi
claudemem --agent callers authenticate
# Step 3: Trace authentication flow
claudemem --agent callees authenticate
# Step 4: Check authorization patterns
claudemem --agent map "authorize permission check guard"
# Step 5: Find sensitive data handlers
claudemem --agent map "password hash token secret key"
# Step 6: Check for test coverage on security code (v0.4.0+)
GAPS=$(claudemem --agent test-gaps --min-pagerank 0.01 2>/dev/null)
if [ -n "$GAPS" ]; then
  # Filter for security-related symbols
  echo "$GAPS" | grep -E "(auth|login|password|token|permission|secret)"
fi
```

**Output Template:**

```markdown
## Security Audit Report

**Authentication:**
- Entry Points: [List]
- Flow: [Description]
- Gaps: [Issues found]

**Authorization:**
- Permission Checks: [Where implemented]
- Coverage: [All routes covered?]

**Sensitive Data:**
- Password Handling: [How stored/compared]
- Token Management: [Generation/validation]
- Secrets: [How managed]

**Test Coverage:**
- Security Code Coverage: [X%]
- Critical Gaps: [List]

**Recommendations:**
1. [Priority 1 fix]
2. [Priority 2 fix]
```

---
```

---

## 7. Files to Create/Modify

### 7.1 Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `plugin.json` | Version bump to 2.6.0, add claudemem-orchestration skill | HIGH |
| `skills/claudemem-search/SKILL.md` | Add Code Analysis Commands, LLM Enrichment, Workflow Templates sections | HIGH |
| `skills/architect-detective/SKILL.md` | Add dead-code command, Phase 5 cleanup, version badges | HIGH |
| `skills/developer-detective/SKILL.md` | Add impact command, update Impact Analysis section, version badges | HIGH |
| `skills/tester-detective/SKILL.md` | Add test-gaps command, update Phase 0, version badges | HIGH |
| `skills/debugger-detective/SKILL.md` | Add impact command for blast radius, version badges | HIGH |
| `skills/ultrathink-detective/SKILL.md` | Add Dimension 7: Code Health, update summary, version badges | HIGH |
| `hooks/session-start.sh` | Add version detection, session cleanup | HIGH [REVISED] |
| `hooks/intercept-grep.sh` | Add dead-code/test-gaps/impact to result suggestion | MEDIUM |
| `hooks/intercept-bash.sh` | Add dead-code/test-gaps/impact to result suggestion | MEDIUM |

### 7.2 Files to Create

| File | Purpose | Priority |
|------|---------|----------|
| `skills/claudemem-orchestration/SKILL.md` | Multi-agent orchestration patterns (references orchestration:multi-model-validation) | HIGH |

### 7.3 No Changes Required

| File | Reason |
|------|--------|
| `agents/codebase-detective.md` | Already references skills, will auto-load new content |
| `commands/analyze.md` | Already uses detective skills |
| `commands/setup.md` | No changes needed |
| `commands/help.md` | No changes needed |
| `hooks/intercept-glob.sh` | Warnings sufficient |
| `hooks/intercept-read.sh` | Warnings sufficient |

---

## 8. Implementation Sequence

### Phase 1: Core Updates (Day 1)

1. **Update plugin.json** (5 min)
   - Bump version to 2.6.0
   - Add claudemem-orchestration skill path

2. **Update session-start.sh** (30 min) [REVISED - NEW]
   - Add version detection for claudemem
   - Add session cleanup with TTL
   - Add graceful degradation messaging

3. **Update claudemem-search skill** (1.5 hours) [REVISED]
   - Add "Code Analysis Commands" section with empty result handling
   - Add "LLM Enrichment Document Types" section
   - Add "Workflow Templates" section with error handling

4. **Create claudemem-orchestration skill** (45 min) [REVISED - reduced scope]
   - Focus on claudemem-specific patterns
   - Reference orchestration:multi-model-validation for parallel execution

### Phase 2: Detective Skill Updates (Day 1-2)

5. **Update architect-detective** (30 min)
   - Add dead-code command with version badge
   - Add Phase 5: Cleanup Opportunities
   - Add empty result handling

6. **Update developer-detective** (30 min)
   - Add impact command with version badge
   - Update Impact Analysis section
   - Add empty result handling

7. **Update tester-detective** (30 min)
   - Add test-gaps command with version badge
   - Add Phase 0: Automated Gap Detection
   - Update "Find Untested Code" section
   - Add empty result handling

8. **Update debugger-detective** (30 min)
   - Add impact command for blast radius with version badge
   - Add empty result handling

9. **Update ultrathink-detective** (30 min)
   - Add Dimension 7: Code Health
   - Update Executive Summary format
   - Add version badges and empty result handling

### Phase 3: Hook Updates (Day 2)

10. **Update intercept-grep.sh** (15 min)
    - Add dead-code/test-gaps/impact to suggested commands

11. **Update intercept-bash.sh** (15 min)
    - Same updates as intercept-grep.sh

### Phase 4: Validation (Day 2)

12. **Manual Testing** (1 hour)
    - Test each new command documentation
    - Verify skill loading
    - Check hook suggestions
    - Test version detection

13. **Integration Testing** (1 hour)
    - Run /analyze with new skills
    - Test multi-agent orchestration pattern
    - Verify workflow templates
    - Test session cleanup

---

## 9. Testing Strategy

### 9.1 Unit Testing

**Skill Loading:**
```bash
# Verify all skills load without errors
claude-code --test-skills code-analysis
```

**Hook Testing:**
```bash
# Test version detection
./hooks/session-start.sh

# Test hook interception with new commands
echo '{"pattern": "dead code"}' | ./hooks/intercept-grep.sh
echo '{"command": "rg dead code"}' | ./hooks/intercept-bash.sh
```

**Session Cleanup Testing:** [REVISED - NEW]
```bash
# Create old session
mkdir -p /tmp/analysis-20231201-000000-test
touch -d "2 days ago" /tmp/analysis-20231201-000000-test

# Run session-start hook
./hooks/session-start.sh

# Verify cleanup
ls /tmp/analysis-20231201-000000-test  # Should not exist
```

### 9.2 Integration Testing

**Detective Skill Usage:**
```bash
# Test architect-detective with dead-code
/analyze --skill architect-detective

# Test tester-detective with test-gaps
/analyze --skill tester-detective

# Test developer-detective with impact
/analyze --skill developer-detective
```

**Workflow Template Verification:**
```
1. Bug Investigation flow
2. New Feature flow
3. Refactoring flow
4. Architecture Understanding flow
5. Security Audit flow
```

### 9.3 Multi-Agent Orchestration Testing

**Parallel Analysis:**
```bash
# Create session
SESSION_DIR=$(mktemp -d)

# Run claudemem once
claudemem --agent map > $SESSION_DIR/structure.md

# Simulate parallel agent reads
# (manual verification of file sharing)
```

### 9.4 Acceptance Criteria

| Test Case | Expected Result |
|-----------|-----------------|
| `claudemem dead-code` documented | Example in claudemem-search skill with empty handling |
| `claudemem test-gaps` documented | Example in claudemem-search and tester-detective with empty handling |
| `claudemem impact` documented | Example in developer-detective and debugger-detective with empty handling |
| Multi-agent pattern documented | Full pattern in claudemem-orchestration skill (refs orchestration) |
| Workflow templates documented | 5 templates in claudemem-search skill with error handling |
| LLM enrichment documented | Document types and --use-case flag in claudemem-search |
| Hook suggestions updated | New commands in intercept-grep.sh and intercept-bash.sh |
| Version bumped | plugin.json shows v2.6.0 |
| Version detection works | session-start.sh detects v0.3.0 vs v0.4.0 |
| Session cleanup works | Old sessions cleaned up on start |
| Static limitations documented | Limitations section in claudemem-search |

---

## 10. Risk Assessment

### 10.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Claudemem v0.4.0 not released | LOW | HIGH | Document as "planned", version detection graceful |
| Command syntax changes | LOW | MEDIUM | Use --help to verify before documenting |
| LLM enrichment requires API key | MEDIUM | LOW | Document as optional feature |
| Multi-agent pattern complexity | MEDIUM | MEDIUM | Reference existing orchestration skill |

### 10.2 Documentation Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Inconsistent formatting | MEDIUM | LOW | Use existing skill as template |
| Missing edge cases | MEDIUM | MEDIUM | Include empty result handling throughout |
| Outdated examples | LOW | MEDIUM | Use flag consistently |

### 10.3 Integration Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Skill conflicts | LOW | HIGH | Test all skills together |
| Hook interference | LOW | MEDIUM | Test hooks with new patterns |
| Plugin loading issues | LOW | HIGH | Validate JSON syntax |

### 10.4 Rollback Plan

If issues are discovered post-release:

1. **Immediate:** Revert plugin.json version
2. **Short-term:** Keep new skills but mark as "experimental"
3. **Documentation:** Add known issues section

### 10.5 Static Analysis Limitations [REVISED - NEW SECTION]

**Document these limitations prominently in claudemem-search skill:**

| Limitation | Affected Commands | User Action |
|------------|-------------------|-------------|
| Dynamic imports (`import()`) | `dead-code`, `callers`, `impact` | Manual verification required |
| Reflection-based access | `dead-code`, `callers` | Check for `eval()`, `Object.keys()` patterns |
| External callers | `dead-code`, `test-gaps` | Consider exported symbols as potentially used |
| Callback/event-driven code | `callers`, `impact` | Check for event listeners, callbacks |
| Dependency injection | `callers`, `callees` | DI containers hide static relationships |
| Test file naming | `test-gaps` | Ensure tests follow `*.test.ts`, `*.spec.ts` patterns |

**Add to claudemem-search skill:**

```markdown
## Static Analysis Limitations [REVISED]

Claudemem uses static AST analysis. Some patterns are not captured:

### Dynamic Imports
```javascript
// NOT visible to static analysis
const module = await import(`./modules/${name}`);
```
**Result:** May show as "dead code" but is actually used dynamically.
**Action:** Mark as "Potentially Dead - Manual Review"

### External Callers
```javascript
// Exported for external use
export function publicAPI() { ... }
```
**Result:** May show 0 callers but used by other repositories.
**Action:** Use `--include-exported` carefully, or mark as "Externally Called - Manual Review Required"

### Reflection/Eval
```javascript
// NOT visible to static analysis
const fn = obj[methodName]();
eval("functionName()");
```
**Result:** Callers not detected.
**Action:** Search codebase for `eval`, `Object.keys`, bracket notation.

### Event-Driven Code
```javascript
// NOT visible as direct callers
emitter.on('event', handler);
document.addEventListener('click', onClick);
```
**Result:** `handler` and `onClick` may show 0 callers.
**Action:** Check for event registration patterns.

### Dependency Injection
```typescript
// Container registration hides relationships
container.register(IService, ServiceImpl);
```
**Result:** `ServiceImpl` may show 0 callers.
**Action:** Check DI container configuration.
```

---

## Appendix A: Full XML Structure for claudemem-orchestration Skill

```xml
<skill>
  <metadata>
    <name>claudemem-orchestration</name>
    <version>1.0.0</version>
    <purpose>Multi-agent code analysis orchestration</purpose>
    <dependencies>
      <skill>orchestration:multi-model-validation</skill>
    </dependencies>
  </metadata>

  <core_patterns>
    <pattern name="Shared Output">
      <step>Run claudemem ONCE</step>
      <step>Write to session directory</step>
      <step>Launch parallel agents reading same files</step>
    </pattern>

    <pattern name="Role-Based Distribution">
      <step>Architect reads structure-map.md</step>
      <step>Tester reads test-gaps.md</step>
      <step>Developer reads dead-code.md</step>
      <step>All execute in parallel</step>
    </pattern>

    <pattern name="Consolidation">
      <step>Ultrathink reads all agent outputs</step>
      <step>Creates unified prioritized report</step>
    </pattern>
  </core_patterns>

  <role_mapping>
    <role name="Architect">
      <primary>map, dead-code</primary>
      <secondary>context</secondary>
    </role>
    <role name="Developer">
      <primary>callers, callees, impact</primary>
      <secondary>symbol</secondary>
    </role>
    <role name="Tester">
      <primary>test-gaps</primary>
      <secondary>callers</secondary>
    </role>
    <role name="Debugger">
      <primary>context, impact</primary>
      <secondary>symbol, callers</secondary>
    </role>
  </role_mapping>

  <session_lifecycle>
    <cleanup_ttl>1 day</cleanup_ttl>
    <cleanup_patterns>
      <pattern>analysis-*</pattern>
      <pattern>plan-review-*</pattern>
      <pattern>review-*</pattern>
    </cleanup_patterns>
  </session_lifecycle>
</skill>
```

---

## Appendix B: Command Quick Reference

### New Commands (v0.4.0+ Required)

```bash
# Dead code detection
claudemem --agent dead-codeclaudemem --agent dead-code --max-pagerank 0.005claudemem --agent dead-code --include-exported
# Test coverage gaps
claudemem --agent test-gapsclaudemem --agent test-gaps --min-pagerank 0.05
# Impact analysis (BFS traversal)
claudemem --agent impact UserServiceclaudemem --agent impact UserService --max-depth 5
# Navigation-optimized search
claudemem --agent search "query" --use-case navigation```

### Existing Commands (v0.3.0)

```bash
# Structural overview
claudemem --agent map "query"
# Symbol location
claudemem --agent symbol SymbolName
# Direct callers
claudemem --agent callers SymbolName
# Direct callees
claudemem --agent callees SymbolName
# Full context
claudemem --agent context SymbolName
# Semantic search
claudemem --agent search "query"```

### Version Check

```bash
# Check installed version
claudemem --version

# Expected output for v0.4.0+:
# claudemem version 0.4.0
```

---

**Document Status:** READY FOR IMPLEMENTATION [REVISED]
**Review Status:** CONDITIONAL APPROVAL - All critical issues addressed
**Next Steps:**
1. Review revised design document
2. Implement with developer agent
3. Run integration tests

---

**Maintained by:** Agent Designer
**Plugin:** code-analysis
**Target Version:** v2.6.0
**Last Updated:** December 23, 2025
**Revision:** 1.1.0 (based on 4-model consolidated review)
