---
name: investigate
description: "Investigate code — architecture, implementation, tests, or bugs. Mode-based routing with mnemex AST analysis. Use when investigation type is unclear or for targeted analysis: architecture (map/PageRank), implementation (callers/callees), testing (test-gaps/callers), debugging (context/call chains)."
allowed-tools: Bash, Task, Read, AskUserQuestion
user-invocable: false
---

# Investigate Skill

Keyword-based routing to the appropriate investigation mode, each using mnemex AST commands optimized for that investigation type.

## Routing

| Mode | Keywords | Primary Commands |
|------|----------|-----------------|
| Bug Investigation | debug, error, broken, failing, crash | `context`, `callers`, `callees` |
| Test Gap Analysis | test, coverage, edge case, mock | `callers` (test files), `test-gaps` |
| Architecture Analysis | architecture, design, structure, layer | `map`, `dependency-graph` |
| Implementation Tracing | how does, implementation, data flow (default) | `callers`, `callees`, `context` |

Higher priority wins when multiple keywords match (Bug > Test > Architecture > Implementation).

---

## SHARED SETUP (All Modes)

### Verify mnemex

```bash
which mnemex && mnemex --version
# Must be v0.3.0+
```

If not installed, use AskUserQuestion with options: Install via npm, Install via Homebrew, Cancel.

### Check Index

```bash
mnemex --version && ls -la .mnemex/index.db 2>/dev/null
```

### Check Index Freshness

```bash
if [ ! -d ".mnemex" ] || [ ! -f ".mnemex/index.db" ]; then
  # AskUserQuestion: [1] Create index now, [2] Cancel
  exit 1
fi

STALE_COUNT=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) \
  -newer .mnemex/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "dist" | grep -v "build" | wc -l)
STALE_COUNT=$((STALE_COUNT + 0))

if [ "$STALE_COUNT" -gt 0 ]; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    INDEX_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" .mnemex/index.db 2>/dev/null)
  else
    INDEX_TIME=$(stat -c "%y" .mnemex/index.db 2>/dev/null | cut -d'.' -f1)
  fi
  INDEX_TIME=${INDEX_TIME:-"unknown time"}
  STALE_SAMPLE=$(find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -newer .mnemex/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | head -5)

  # AskUserQuestion: [1] Reindex now (Recommended), [2] Proceed with stale, [3] Cancel
fi
```

### Index if Needed

```bash
mnemex index
```

### FALLBACK PROTOCOL (All Modes)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║   FALLBACK PROTOCOL (NEVER SILENT)                                          ║
║   If mnemex fails OR returns irrelevant results:                          ║
║   1. STOP — Do not silently switch to grep/find                              ║
║   2. DIAGNOSE — Run mnemex status                                         ║
║   3. COMMUNICATE — Tell user what happened                                   ║
║   4. ASK — Use AskUserQuestion for next steps                                ║
║   grep/find/Glob FORBIDDEN without explicit user approval                    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

```typescript
AskUserQuestion({
  questions: [{
    question: "mnemex failed or returned no relevant results. How should I proceed?",
    header: "Investigation Issue",
    multiSelect: false,
    options: [
      { label: "Reindex codebase", description: "Run mnemex index (~1-2 min)" },
      { label: "Try different query", description: "Rephrase the search" },
      { label: "Use grep (not recommended)", description: "Traditional search — loses AST analysis" },
      { label: "Cancel", description: "Stop investigation" }
    ]
  }]
})
```

### Never Truncate Output

```
FORBIDDEN: mnemex --agent map "q" | head -80
FORBIDDEN: mnemex --agent callers X | tail -50
FORBIDDEN: mnemex --agent search "x" | grep -m 10 "y"

CORRECT: mnemex --agent map "query"
CORRECT: mnemex --agent search "auth" -n 10        (built-in limit)
CORRECT: mnemex --agent map "q" --tokens 2000      (token-limited)
CORRECT: mnemex --agent context Func --max-depth 3  (depth-limited)
```

---

## Routing Workflow

### Phase 1: Detect Mode

```bash
INVESTIGATION_QUERY="${TASK_DESCRIPTION:-$USER_QUERY}"
QUERY_LOWER=$(echo "$INVESTIGATION_QUERY" | tr '[:upper:]' '[:lower:]')

if echo "$QUERY_LOWER" | grep -qE "debug|error|broken|failing|crash"; then
  MODE="bug"
  RATIONALE="Bug investigation requires call chain tracing"
elif echo "$QUERY_LOWER" | grep -qE "test|coverage|edge case|mock"; then
  MODE="test"
  RATIONALE="Test analysis requires callers analysis for coverage gaps"
elif echo "$QUERY_LOWER" | grep -qE "architecture|design|structure|layer"; then
  MODE="architecture"
  RATIONALE="Architecture requires PageRank analysis"
else
  MODE="implementation"
  RATIONALE="Implementation tracing via callers/callees (default)"
fi
```

### Phase 2: Announce Routing

```bash
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Investigation Routing"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Query: $INVESTIGATION_QUERY"
echo "Mode: $MODE"
echo "Reason: $RATIONALE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
```

### Phase 3: Execute Mode

Proceed to the appropriate mode section below.

---

## Architecture Analysis

**Use when:** "what's the architecture", "how are layers structured", "find design patterns", "map the system"

**Primary commands:** `map` (PageRank), `symbol`, `callers`, `callees`, `dependency-graph`

### Why `map` Works for Architecture

- High-PageRank symbols = Core abstractions everything depends on
- Symbol kinds organized by type (class, interface, function)
- File distribution reveals layer structure
- Dependency centrality shows which code is most connected

### Analyze

```bash
# Get high-level architecture overview
mnemex --agent map "architecture layers"
mnemex --agent map  # Full map, sorted by importance

# Map specific architectural concerns
mnemex --agent map "service layer business logic"
mnemex --agent map "repository data access"
mnemex --agent map "controller API endpoints"
mnemex --agent map "middleware request handling"
```

### Identify Layers

```bash
# Find interfaces/contracts (architectural boundaries)
mnemex --agent map "interface contract abstract"
# Dependency injection points
mnemex --agent map "inject provider module"
# Configuration and bootstrap
mnemex --agent map "config bootstrap initialize"
```

### Identify Patterns

```bash
mnemex --agent map "factory create builder"
mnemex --agent map "repository persist query"
mnemex --agent map "event emit subscribe handler"
```

### Trace Dependencies

```bash
# For a core abstraction, see what depends on it
mnemex --agent callers CoreService
# See what it depends on
mnemex --agent callees CoreService
# Full transitive dependencies
mnemex --agent dependency-graph CoreService
```

### Find Dead Code (v0.4.0+ Required)

```bash
DEAD_CODE=$(mnemex --agent dead-code)
if [ -z "$DEAD_CODE" ]; then
  echo "No dead code found — architecture is well-maintained"
else
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

High PageRank + dead = Something broke recently (investigate).
Low PageRank + dead = Safe to remove.

**Limitations:** Results labeled "Potentially Dead" require manual verification for dynamically imported modules, reflection-accessed code, and external API consumers.

### Persist Architecture Findings

Architecture knowledge is expensive to re-derive. Write findings to memory after deep investigation:

```bash
memory_write("auth/architecture", "AuthService is central (PageRank 0.092). Pattern: Service Layer → Repository → Database.")
memory_write("project/conventions", "No direct DB access from controllers. All writes through Repository pattern.")
memory_list()
memory_read("auth/architecture")
```

### PageRank Reference

| PageRank | Architectural Role | Action |
|----------|--------------------|--------|
| > 0.05 | Core abstraction | Analyze first — this IS the architecture |
| 0.01–0.05 | Important component | Key building block |
| 0.001–0.01 | Standard component | Normal code |
| < 0.001 | Leaf/utility | Skip for architecture analysis |

### Architecture Output Format

```
┌─────────────────────────────────────────────────────────┐
│                 ARCHITECTURE ANALYSIS                    │
├─────────────────────────────────────────────────────────┤
│  Pattern: [Detected pattern]                             │
│  Core Abstractions (PageRank > 0.05):                   │
│    - UserService (0.092) - Central business logic       │
│    - Database (0.078) - Data access foundation          │
│  Search Method: mnemex (AST + PageRank)               │
└─────────────────────────────────────────────────────────┘

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

### Validate Architecture Results

```bash
RESULTS=$(mnemex --agent map "service layer business logic")
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  DIAGNOSIS=$(mnemex status 2>&1)
  # Use AskUserQuestion
fi

if [ -z "$RESULTS" ]; then
  echo "WARNING: No symbols found — may be wrong query or index issue"
fi

HIGH_PR=$(echo "$RESULTS" | grep "pagerank:" | awk -F': ' '{if ($2 > 0.01) print}' | wc -l)
if [ "$HIGH_PR" -eq 0 ]; then
  # No architectural symbols found — use AskUserQuestion: Reindex, Broaden query, or Cancel
fi
```

---

## Implementation Tracing

**Use when:** "how does X work", "find implementation of", "trace data flow", "where is X defined"

**Primary commands:** `callers`, `callees`, `context`, `symbol`

### Why callers/callees Works for Implementation

- `callers` = Every place that calls this code (impact of changes)
- `callees` = Every function this code calls (its dependencies)
- Exact file:line = Precise locations
- Call kinds = call, import, extends, implements

### Trace

```bash
# Find where a function is defined
mnemex --agent symbol processPayment
# Get full context
mnemex --agent context processPayment

# What does this function call? (data flows OUT)
mnemex --agent callees processPayment
# Follow the chain
mnemex --agent callees validateCard
mnemex --agent callees chargeStripe

# Who calls this function? (usage patterns)
mnemex --agent callers processPayment
```

### LSP Enrichment (Before Modifying)

After locating a symbol, enrich with live type information before any edit:

```bash
hover("processPayment")   # Current type signature
define("processPayment")  # Exact declaration for overloaded names
```

Safe-edit checkpoint: `symbol → hover → think → edit_symbol` (NOT Grep → Read → Edit)

### Impact Analysis (v0.4.0+ Required)

```bash
# Before modifying ANY code, check full transitive impact
IMPACT=$(mnemex --agent impact functionToChange)

if [ -z "$IMPACT" ] || echo "$IMPACT" | grep -q "No callers"; then
  echo "No static callers — verify dynamic usage patterns"
else
  echo "$IMPACT"
fi
```

`callers` shows only direct callers (1 level). `impact` shows ALL transitive callers (full tree). Critical for refactoring decisions.

### Implementation Output Format

```
┌─────────────────────────────────────────────────────────┐
│              IMPLEMENTATION ANALYSIS                     │
├─────────────────────────────────────────────────────────┤
│  Symbol: processPayment                                  │
│  Location: src/services/payment.ts:45-89                │
│  PageRank: 0.034                                         │
│  Search Method: mnemex (AST analysis)                │
└─────────────────────────────────────────────────────────┘

Data Flow (Callees):
processPayment
  ├── validateCard (src/validators/card.ts:12)
  ├── getCustomer (src/services/customer.ts:34)
  └── saveTransaction (src/repositories/transaction.ts:78)

Usage (Callers):
  ├── CheckoutController.submit (src/controllers/checkout.ts:45)
  └── SubscriptionService.renew (src/services/subscription.ts:89)
```

### Validate Implementation Results

```bash
SYMBOL=$(mnemex --agent symbol PaymentService)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ] || [ -z "$SYMBOL" ] || echo "$SYMBOL" | grep -qi "not found\|error"; then
  DIAGNOSIS=$(mnemex --version && ls -la .mnemex/index.db 2>&1)
  # AskUserQuestion: [1] Reindex, [2] Try different name, [3] Cancel
fi

CALLERS=$(mnemex --agent callers PaymentService)
if echo "$CALLERS" | grep -qi "error\|failed"; then
  # AskUserQuestion
fi
```

---

## Test Gap Analysis

**Use when:** "what's tested", "find test coverage", "audit test quality", "missing tests", "edge cases"

**Primary commands:** `callers` (identify test files), `test-gaps`, `map "test spec"`

### Why callers Works for Test Analysis

- Tests appear as callers of the functions they test
- No test callers = coverage gap
- Exact test-to-code mapping via AST
- Filter callers by file path (*.test.ts, *.spec.ts)

### Analyze Test Coverage

```bash
# Who calls this function? (test files will appear as callers)
mnemex --agent callers processPayment
# src/services/payment.test.ts:45 → This is a test caller

# Map test infrastructure
mnemex --agent map "test spec describe it"
mnemex --agent map "test helper mock stub"
mnemex --agent map "fixture factory builder"
```

### Automated Gap Detection (v0.4.0+ Required — Do This First)

```bash
GAPS=$(mnemex --agent test-gaps)

if [ -z "$GAPS" ] || echo "$GAPS" | grep -q "No test gaps"; then
  echo "Excellent test coverage! All high-importance code has tests."
  echo "Optional: Check lower-importance code:"
  mnemex --agent test-gaps --min-pagerank 0.005
else
  echo "Test Coverage Gaps Found:"
  echo "$GAPS"
fi

# Focus on critical gaps only
mnemex --agent test-gaps --min-pagerank 0.05
```

`test-gaps` automatically finds high-PageRank symbols with 0 test callers and returns a prioritized list.

**Limitations:** Test detection relies on file naming patterns (`*.test.ts`, `*.spec.ts`, `*_test.go`). Integration tests in non-standard locations may not be detected.

### LSP Reference Verification

The `references` tool provides LSP-backed discovery — more complete than `callers` for test detection:

```bash
references("processPayment")
# Includes mock setup files (vi.mock, jest.mock) that AST may miss
# Includes dynamic test patterns (describe.each)
```

When `references` finds more than `callers`: add "LSP References" alongside "AST Callers" in output.

### Manual Coverage Check (v0.3.0 compatible)

```bash
# For each critical function, check callers
mnemex --agent callers authenticateUser
mnemex --agent callers processPayment
mnemex --agent callers saveToDatabase

# Count test vs production callers
TEST_CALLERS=$(echo "$CALLERS" | grep -E "\.test\.|\.spec\.|_test\." | wc -l)
PROD_CALLERS=$(echo "$CALLERS" | grep -v -E "\.test\.|\.spec\.|_test\." | wc -l)

if [ "$TEST_CALLERS" -eq 0 ]; then
  echo "WARNING: No test coverage found for this function"
fi
```

### Test Coverage Output Format

```
┌─────────────────────────────────────────────────────────┐
│                   TEST INFRASTRUCTURE                    │
├─────────────────────────────────────────────────────────┤
│  Framework: [Detected framework]                        │
│  Test Files: N files (*.spec.ts, *.test.ts)             │
│  Search Method: mnemex (callers analysis)            │
└─────────────────────────────────────────────────────────┘

Coverage by Function:
| Function            | Test Callers | Coverage |
|---------------------|--------------|----------|
| authenticateUser    | 5 tests      | Good     |
| calculateDiscount   | 0 tests      | NONE     |

HIGH PRIORITY — No Test Callers:
   calculateDiscount (PageRank: 0.034)
   └── 4 production callers, 0 test callers

MEDIUM PRIORITY — Few Test Callers:
   sendEmail (PageRank: 0.021)
   └── 1 test, no error scenarios
```

### Validate Test Results

```bash
CALLERS=$(mnemex --agent callers processPayment)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  DIAGNOSIS=$(mnemex status 2>&1)
  # AskUserQuestion for recovery
fi

if echo "$CALLERS" | grep -qi "error\|failed"; then
  # AskUserQuestion
fi

if [ -z "$(mnemex --agent map "test spec describe")" ]; then
  echo "WARNING: No test infrastructure found"
  # May indicate non-standard test locations or index gap
fi
```

---

## Bug Investigation

**Use when:** "why is X broken", "find bug source", "root cause analysis", "trace error", "debug issue"

**Primary commands:** `context`, `callers`, `callees`, `impact`

### Why `context` Works for Debugging

- Symbol definition = Where the buggy code is
- Callers = How we got here (trace backwards)
- Callees = What happens next (trace forward)
- Full call chain = Complete picture for root cause analysis

### Locate the Bug

```bash
# Find the function mentioned in error
mnemex --agent symbol authenticate
# Get full context (callers + callees)
mnemex --agent context authenticate
```

### LSP Type Verification

During debugging, verify types at the error boundary:

```bash
hover("authenticate")     # Verify return type matches callers' expectations
define("authenticate")    # Identify exact overload being called
references("authenticate") # All call sites (more complete than callers for dynamic dispatch)
```

Type mismatches between what `hover` shows (actual type) and what callers expect are a leading cause of runtime errors.

### Trace Backwards (Root Cause)

```bash
mnemex --agent callers authenticate
mnemex --agent callers LoginController
mnemex --agent callers handleRequest
```

### Trace Forward (Effect)

```bash
mnemex --agent callees authenticate
mnemex --agent callees updateSession
```

### Blast Radius Analysis (v0.4.0+ Required)

```bash
IMPACT=$(mnemex --agent impact buggyFunction)

if [ -z "$IMPACT" ] || echo "$IMPACT" | grep -q "No callers"; then
  echo "No static callers — bug is isolated (or dynamically called)"
else
  echo "$IMPACT"
fi
```

Use for: post-fix verification, regression prevention, incident documentation.

**Limitations:** Event-driven/callback architectures may have callers not visible to static analysis.

### Error Origin Hunting

```bash
mnemex --agent map "throw error exception"
mnemex --agent symbol AuthenticationError
mnemex --agent callers AuthenticationError
```

### State Mutation Tracking

```bash
mnemex --agent map "set state update mutate"
mnemex --agent symbol updateUserState
mnemex --agent callers updateUserState
```

### Bug Investigation Output Format

```
┌─────────────────────────────────────────────────────────┐
│                    BUG INVESTIGATION                     │
├─────────────────────────────────────────────────────────┤
│  Symptom: [Error description]                            │
│  Location: src/[file]:line                              │
│  Actual Type: (from hover)                               │
│  Expected Type: (from calling context)                   │
│  Search Method: mnemex (AST call chain)              │
└─────────────────────────────────────────────────────────┘

Call Chain (backwards):
SYMPTOM: [error]
   └── src/components/Profile.tsx:45
       ↑ CALLER
   └── useUser hook (src/hooks/useUser.ts:23)
       ↑ ROOT CAUSE FOUND HERE

Root Cause:
Location: src/mappers/user.ts:12
Problem: [description]
Evidence: [from callers/callees/context output]

Impact:
mnemex --agent callers [buggy function] shows N affected locations
```

### Validate Bug Investigation Results

```bash
CONTEXT=$(mnemex --agent context failingFunction)
EXIT_CODE=$?

if [ "$EXIT_CODE" -ne 0 ]; then
  DIAGNOSIS=$(mnemex status 2>&1)
  # AskUserQuestion
fi

if ! echo "$CONTEXT" | grep -q "\[symbol\]"; then
  # Missing symbol section — function not found
  # AskUserQuestion: Reindex, Different name, or Cancel
fi

# 0 callers could mean: entry point (expected), dead code, or dynamic call
if echo "$CONTEXT" | grep -qi "error\|not found"; then
  # AskUserQuestion
fi
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

if mnemex feedback --help 2>&1 | grep -qi "feedback"; then
  timeout 5 mnemex feedback \
    --query "$SEARCH_QUERY" \
    --helpful "${HELPFUL_IDS#,}" \
    --unhelpful "${UNHELPFUL_IDS#,}" 2>/dev/null || true
fi
```

---

**Maintained by:** MadAppGang
**Plugin:** code-analysis v5.0.0
**Last Updated:** March 2026 (v5.0.0 - Consolidated from investigate + 4 specialist skills)
