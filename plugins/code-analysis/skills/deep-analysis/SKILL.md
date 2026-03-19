---
name: deep-analysis
description: "Comprehensive multi-dimensional codebase analysis. Best for: 'comprehensive audit', 'deep analysis', 'full codebase review', 'multi-perspective investigation', 'analyze architecture', 'trace flow'. Uses ALL claudemem AST commands with PageRank, chain-of-thought reasoning, and code health assessment."
allowed-tools: Bash, Task, Read, AskUserQuestion
model: opus
---

# Deep Code Analysis

This skill provides comprehensive codebase investigation using all claudemem AST analysis commands across multiple dimensions: architecture, implementation, test coverage, reliability, security, performance, and code health.

## When to Use This Skill

- Comprehensive audits and full codebase reviews
- Complex bugs spanning multiple systems
- Major refactoring or architecture decision records
- Technical debt assessment and prioritization
- New developer onboarding
- Post-incident root cause analysis
- Security audits
- Multi-perspective investigation when a single dimension is insufficient

## Command Reference

| Command | Primary Use |
|---------|-------------|
| `claudemem --agent map "query"` | Architecture overview with PageRank |
| `claudemem --agent symbol <name>` | Exact file:line location |
| `claudemem --agent callers <name>` | Impact analysis — what calls this |
| `claudemem --agent callees <name>` | Dependency tracing — what this calls |
| `claudemem --agent context <name>` | Full call chain (callers + callees) |
| `claudemem --agent search "query"` | Semantic search |
| `claudemem --agent dependency-graph <name>` | Transitive dependency visualization |

In Claude Code with code-analysis plugin, call these as MCP tools directly: `map`, `symbol`, `callers`, `callees`, `context`, `search`, `dependency-graph`.

---

## PHASE 0: MANDATORY SETUP

### Step 1: Verify claudemem

```bash
which claudemem && claudemem --version
# Must be v0.3.0+
```

### Step 2: If Not Installed — STOP

```typescript
AskUserQuestion({
  questions: [{
    question: "claudemem v0.3.0+ (AST structural analysis) is required. How would you like to proceed?",
    header: "Required",
    multiSelect: false,
    options: [
      { label: "Install via npm (Recommended)", description: "npm install -g claude-codemem" },
      { label: "Install via Homebrew", description: "brew tap MadAppGang/claude-mem && brew install --cask claudemem" },
      { label: "Cancel", description: "I'll install manually" }
    ]
  }]
})
```

### Step 3: Check Index Status

```bash
claudemem --version && ls -la .claudemem/index.db 2>/dev/null
```

### Step 4: Check Index Freshness

```bash
if [ ! -d ".claudemem" ] || [ ! -f ".claudemem/index.db" ]; then
  # Use AskUserQuestion: [1] Create index now (Recommended), [2] Cancel
  exit 1
fi

STALE_COUNT=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) \
  -newer .claudemem/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "dist" | grep -v "build" | wc -l)
STALE_COUNT=$((STALE_COUNT + 0))

if [ "$STALE_COUNT" -gt 0 ]; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    INDEX_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" .claudemem/index.db 2>/dev/null)
  else
    INDEX_TIME=$(stat -c "%y" .claudemem/index.db 2>/dev/null | cut -d'.' -f1)
  fi
  INDEX_TIME=${INDEX_TIME:-"unknown time"}
  STALE_SAMPLE=$(find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -newer .claudemem/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | head -5)

  # AskUserQuestion: [1] Reindex now (Recommended), [2] Proceed with stale, [3] Cancel
fi
```

**If user proceeds with stale index**, display warning:

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  WARNING: Index is stale — results may not reflect recent code changes.      ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### Step 5: Index if Needed

```bash
claudemem index
```

---

## Multi-Dimensional Analysis Framework

### Dimension 1: Architecture (map command)

```bash
# Get overall structure with PageRank
claudemem --agent map
# Focus on high-PageRank symbols (> 0.05) — these ARE the architecture

# Layer identification
claudemem --agent map "controller handler endpoint"   # Presentation
claudemem --agent map "service business logic"        # Business
claudemem --agent map "repository database query"     # Data

# Pattern detection
claudemem --agent map "factory create builder"
claudemem --agent map "interface abstract contract"
claudemem --agent map "event emit subscribe"
```

### Dimension 2: Implementation (callers/callees)

```bash
# For high-PageRank symbols, trace dependencies
claudemem --agent callees PaymentService
# What calls critical code?
claudemem --agent callers processPayment
# Full dependency chain
claudemem --agent context OrderController
```

### Dimension 3: Test Coverage (callers analysis)

```bash
# Find tests for critical functions
claudemem --agent callers authenticateUser
# Look for callers from *.test.ts or *.spec.ts

# Map test infrastructure
claudemem --agent map "test spec describe it"
claudemem --agent map "mock stub spy helper"

# Coverage gaps = functions with 0 test callers
claudemem --agent callers criticalFunction
# If no test file callers: coverage gap
```

### Dimension 4: Reliability (context command)

```bash
# Error handling chains
claudemem --agent context handleError
# Exception flow
claudemem --agent map "throw error exception"
claudemem --agent callers CustomError
# Recovery patterns
claudemem --agent map "retry fallback circuit"
```

### Dimension 5: Security (symbol + callers)

```bash
# Authentication
claudemem --agent symbol authenticate
claudemem --agent callees authenticate
claudemem --agent callers authenticate
# Authorization
claudemem --agent map "permission role check guard"
# Sensitive data
claudemem --agent map "password hash token secret"
claudemem --agent callers encrypt
```

### Dimension 6: Performance (semantic search)

```bash
# Database patterns
claudemem --agent search "query database batch"
# Async patterns
claudemem --agent map "async await promise parallel"
# Caching
claudemem --agent map "cache memoize store"
```

Track feedback for search queries used in this dimension:

```bash
PERF_QUERY="query database batch"
PERF_RESULTS=$(claudemem --agent search "$PERF_QUERY")
PERF_HELPFUL=""
PERF_UNHELPFUL=""

# During analysis: PERF_HELPFUL="$PERF_HELPFUL,abc123"
# At end of investigation:
if claudemem feedback --help 2>&1 | grep -qi "feedback"; then
  timeout 5 claudemem feedback \
    --query "$PERF_QUERY" \
    --helpful "${PERF_HELPFUL#,}" \
    --unhelpful "${PERF_UNHELPFUL#,}" \
    2>/dev/null || true
fi
```

### Dimension 7: Code Health (v0.4.0+ Required)

```bash
# Dead code detection
DEAD=$(claudemem --agent dead-code)

if [ -n "$DEAD" ]; then
  # High PageRank dead = Something broke (investigate)
  # Low PageRank dead = Cleanup candidate
  echo "$DEAD"
else
  echo "No dead code found."
fi

# Test coverage gaps
GAPS=$(claudemem --agent test-gaps)

if [ -n "$GAPS" ]; then
  echo "$GAPS"
  # For critical gaps (pagerank > 0.05), show full impact
  for symbol in $(echo "$GAPS" | grep "pagerank: 0.0[5-9]" | awk '{print $4}'); do
    claudemem --agent impact "$symbol"
  done
else
  echo "No test gaps found."
fi
```

---

## Comprehensive Analysis Workflow

### Phase 1: Architecture Mapping

```bash
# Structural overview with PageRank
claudemem --agent map
# Document high-PageRank symbols (> 0.05) — architectural pillars

# Map each layer
claudemem --agent map "controller route endpoint"
claudemem --agent map "service business domain"
claudemem --agent map "repository data persist"
```

### Phase 2: Critical Path Analysis

```bash
# For each high-PageRank symbol:

# Get exact location
claudemem --agent symbol PaymentService
# Trace dependencies (what it needs)
claudemem --agent callees PaymentService
# Trace usage (what depends on it)
claudemem --agent callers PaymentService
# Full context for complex ones
claudemem --agent context PaymentService
```

### Phase 3: Test Coverage Assessment

```bash
claudemem --agent callers processPayment
claudemem --agent callers authenticateUser
claudemem --agent callers updateProfile
# Count test callers (from *.test.ts, *.spec.ts)
# High PageRank + 0 test callers = CRITICAL GAP
```

### Phase 4: Risk Identification

```bash
# Security symbols
claudemem --agent map "auth session token"
claudemem --agent callers validateToken
# Error handling
claudemem --agent map "error exception throw"
claudemem --agent context handleFailure
# External integrations
claudemem --agent map "API external webhook"
claudemem --agent callers stripeClient
```

### Phase 5: Technical Debt Inventory

```bash
# Deprecated patterns
claudemem --agent search "TODO FIXME deprecated"
# Complexity indicators (high PageRank but many callees)
claudemem --agent callees LargeService
# > 20 callees = potential god class

# Orphaned code (low PageRank, 0 callers)
claudemem --agent callers unusedFunction
```

---

## Result Validation

After EVERY claudemem command, validate results before proceeding.

**Map commands:**

```bash
RESULTS=$(claudemem --agent map "service layer business logic")
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "ERROR: claudemem map failed"
  # Use AskUserQuestion — see Fallback Protocol
  exit 1
fi

if [ -z "$RESULTS" ]; then
  echo "WARNING: No symbols found — may be wrong query or index issue"
fi

if ! echo "$RESULTS" | grep -q "pagerank:"; then
  echo "WARNING: No PageRank data — index may be corrupted or outdated"
fi
```

**All other commands:**

```bash
RESULTS=$(claudemem --agent [command] [args])
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  DIAGNOSIS=$(claudemem --version && ls -la .claudemem/index.db 2>&1)
  # Use AskUserQuestion for recovery
fi

# Validate relevance using keywords from the investigation query
MATCH_COUNT=0
for kw in $KEYWORDS; do
  if echo "$RESULTS" | grep -qi "$kw"; then
    MATCH_COUNT=$((MATCH_COUNT + 1))
  fi
done

if [ "$MATCH_COUNT" -eq 0 ]; then
  # Results don't match query — use AskUserQuestion
fi
```

**Callers for test coverage:**

```bash
RESULTS=$(claudemem --agent callers $FUNCTION)

if echo "$RESULTS" | grep -qi "error\|not found"; then
  # Actual error vs no callers — use AskUserQuestion
fi
```

---

## FALLBACK PROTOCOL

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   FALLBACK PROTOCOL (NEVER SILENT)                                          ║
║                                                                              ║
║   If claudemem fails OR returns irrelevant results:                          ║
║                                                                              ║
║   1. STOP - Do not silently switch to grep/find                              ║
║   2. DIAGNOSE - Run claudemem status to check index health                   ║
║   3. COMMUNICATE - Tell user what happened                                   ║
║   4. ASK - Get explicit user permission via AskUserQuestion                  ║
║                                                                              ║
║   grep/find/Glob ARE FORBIDDEN without explicit user approval                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

```typescript
AskUserQuestion({
  questions: [{
    question: "claudemem failed or returned irrelevant results. How should I proceed?",
    header: "Investigation Issue",
    multiSelect: false,
    options: [
      { label: "Reindex codebase", description: "Run claudemem index (~1-2 min)" },
      { label: "Try different query", description: "Rephrase the search" },
      { label: "Use grep (not recommended)", description: "Traditional search — loses semantic understanding" },
      { label: "Cancel", description: "Stop investigation" }
    ]
  }]
})
```

If user explicitly chooses grep fallback:

```markdown
## WARNING: Using Fallback Search (grep)

| Feature | claudemem | grep |
|---------|-----------|------|
| Semantic understanding | Yes | No |
| Call graph analysis | Yes | No |
| PageRank ranking | Yes | No |
| False positives | Low | High |

Recommendation: After completing this task, run `claudemem index` to rebuild the index.
```

---

## NEVER TRUNCATE CLAUDEMEM OUTPUT

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   OUTPUT TRUNCATION IS FORBIDDEN                                             ║
║                                                                              ║
║   FORBIDDEN (any form of output truncation):                                 ║
║     claudemem --agent map "query" | head -80                                 ║
║     claudemem --agent callers X | tail -50                                   ║
║     claudemem --agent search "x" | grep -m 10 "y"                            ║
║     claudemem --agent map "q" | awk 'NR <= 50'                               ║
║                                                                              ║
║   CORRECT (use full output or built-in flags):                               ║
║     claudemem --agent map "query"                                            ║
║     claudemem --agent search "auth" -n 10        # Built-in limit            ║
║     claudemem --agent map "q" --tokens 2000      # Token-limited             ║
║     claudemem --agent search "x" --page-size 20 --page 1  # Paginated       ║
║     claudemem --agent context Func --max-depth 3  # Depth-limited           ║
║                                                                              ║
║   WHY: search/map results are sorted by relevance/PageRank.                  ║
║   Truncating loses the most critical results.                                ║
║                                                                              ║
║   EXCEPTION: head -5 for sampling stale files (freshness check) is valid.   ║
║   This prohibition applies only to claudemem command output.                 ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

---

## Output Format: Comprehensive Report

### Executive Summary

```
┌─────────────────────────────────────────────────────────────────┐
│              CODEBASE COMPREHENSIVE ANALYSIS                     │
├─────────────────────────────────────────────────────────────────┤
│  Overall Health: [score]/10                                     │
│  Search Method: claudemem (AST + PageRank)                      │
│                                                                  │
│  Dimensions:                                                     │
│  ├── Architecture:    [score] [map analysis]                    │
│  ├── Implementation:  [score] [callers/callees]                 │
│  ├── Testing:         [score] [test-gaps]                       │
│  ├── Reliability:     [score] [context tracing]                 │
│  ├── Security:        [score] [auth callers]                    │
│  ├── Performance:     [score] [async patterns]                  │
│  └── Code Health:     [score] [dead-code + impact]              │
│                                                                  │
│  Critical: N | Major: N | Minor: N                              │
└─────────────────────────────────────────────────────────────────┘
```

### Architecture (from map)

```
Core Abstractions (PageRank > 0.05):
├── UserService (0.092) - Central business logic
├── Database (0.078) - Data access foundation
└── AuthMiddleware (0.056) - Security boundary

Layer Structure:
  PRESENTATION (src/controllers/)
    └── UserController (0.034)
          ↓
  BUSINESS (src/services/)
    └── UserService (0.092) HIGH PAGERANK
          ↓
  DATA (src/repositories/)
    └── Database (0.078) HIGH PAGERANK
```

### Action Items (Prioritized by PageRank Impact)

```
IMMEDIATE (This Sprint) — Affects High-PageRank Code

   1. [Critical finding + evidence from claudemem output]

SHORT-TERM (Next 2 Sprints)

   2. [Important finding + evidence]

MEDIUM-TERM (This Quarter)

   3. [Improvement + evidence]
```

---

## Feedback Reporting (v0.8.0+)

After completing investigation, report search feedback if `search` was used:

```bash
SEARCH_QUERY="your original query"
HELPFUL_IDS=""
UNHELPFUL_IDS=""

# When reading a helpful result: HELPFUL_IDS="$HELPFUL_IDS,$result_id"
# When reading an unhelpful result: UNHELPFUL_IDS="$UNHELPFUL_IDS,$result_id"

if claudemem feedback --help 2>&1 | grep -qi "feedback"; then
  timeout 5 claudemem feedback \
    --query "$SEARCH_QUERY" \
    --helpful "${HELPFUL_IDS#,}" \
    --unhelpful "${UNHELPFUL_IDS#,}" 2>/dev/null || true
fi
```

| Result Type | Mark As | Reason |
|-------------|---------|--------|
| Read and used | Helpful | Contributed to investigation |
| Read but irrelevant | Unhelpful | False positive |
| Skipped after preview | Unhelpful | Not relevant to query |
| Never read | (Don't track) | Can't evaluate |

---

**Maintained by:** MadAppGang
**Plugin:** code-analysis v5.0.0
**Last Updated:** March 2026 (v5.0.0 - Consolidated from deep-analysis + ultrathink-detective)
