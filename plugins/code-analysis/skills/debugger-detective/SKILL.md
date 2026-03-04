---
name: debugger-detective
description: "⚡ Debugging skill. Best for: 'why is X broken', 'find bug source', 'root cause analysis', 'trace error', 'debug issue'. Uses claudemem AST with context command for efficient call chain analysis."
allowed-tools: Bash, Task, Read, AskUserQuestion
---

# Debugger Detective Skill

This skill uses claudemem's context command for debugging and root cause analysis.

## Why Claudemem Works Better for Debugging

| Task | claudemem | Native Tools |
|------|-----------|--------------|
| Trace backwards | `callers` shows call chain | Manual tracing |
| Trace forwards | `callees` shows dependencies | Manual tracing |
| Full context | `context` gives both directions | Multiple reads |
| Root cause | Call chain reveals origin | Trial and error |

**Primary commands:**
- `claudemem --agent context <name>` - Full call chain (callers + callees)
- `claudemem --agent callers <name>` - Trace back to error source
- `claudemem --agent callees <name>` - Trace forward from failure point

# Debugger Detective Skill

**Version:** 3.3.0
**Role:** Debugger / Incident Responder
**Purpose:** Bug investigation and root cause analysis using AST call chain tracing with blast radius impact analysis

## Role Context

You are investigating this codebase as a **Debugger**. Your focus is on:
- **Error origins** - Where exceptions are thrown
- **Call chains** - How execution flows to the failure point
- **State mutations** - What changed the data before failure
- **Root causes** - The actual source of problems (not just symptoms)
- **Impact radius** - What else might be affected

## Why `context` is Perfect for Debugging

The `context` command shows you:
- **Symbol definition** = Where the buggy code is
- **Callers** = How we got here (trace backwards)
- **Callees** = What happens next (trace forward)
- **Full call chain** = Complete picture for root cause analysis

## Debugger-Focused Commands (v0.3.0)

### Find the Bug Location

```bash
# Find the function mentioned in error
claudemem --agent symbol authenticate
# Get full context (callers + callees)
claudemem --agent context authenticate```

### Phase 2b: LSP Type Verification

During debugging, use LSP to verify types at the error boundary:

```bash
# Verify the type of the buggy function's return value
hover("authenticate")
# Use: check if return type matches what callers expect (common bug source)

# If multiple overloads exist:
define("authenticate")
# Use: identify exactly which overload is being called

# Find all references to the failing symbol (LSP-backed, more complete than callers)
references("authenticate")
# Use: find call sites that may not appear in AST callers (dynamic dispatch)
```

**Key debugging insight**: Type mismatches between what `hover` shows (actual type) and what callers expect (from `callers` output) are a leading cause of runtime errors.

### Trace Back to Source (callers)

```bash
# Who called this function? (trace backwards)
claudemem --agent callers authenticate
# Follow the chain backwards
claudemem --agent callers LoginControllerclaudemem --agent callers handleRequest```

### Trace Forward to Effect (callees)

```bash
# What does this function call? (trace forward)
claudemem --agent callees authenticate
# Find where state changes happen
claudemem --agent callees updateSession```

### Blast Radius Analysis (v0.4.0+ Required)

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

**Limitations:**
Event-driven/callback architectures may have callers not visible to static analysis.

### Error Origin Hunting

```bash
# Map error handling code
claudemem --agent map "throw error exception"
# Find specific error types
claudemem --agent symbol AuthenticationError
# Who throws this error?
claudemem --agent callers AuthenticationError```

### State Mutation Tracking

```bash
# Find where state changes
claudemem --agent map "set state update mutate"
# Find the mutation function
claudemem --agent symbol updateUserState
# Who calls this mutation?
claudemem --agent callers updateUserState```

## PHASE 0: MANDATORY SETUP

### Step 1: Verify claudemem v0.3.0

```bash
which claudemem && claudemem --version
# Must be 0.3.0+
```

### Step 2: If Not Installed → STOP

Use AskUserQuestion (see ultrathink-detective for template)

### Step 3: Check Index Status

```bash
# Check claudemem installation and index
claudemem --version && ls -la .claudemem/index.db 2>/dev/null
```

### Step 3.5: Check Index Freshness

Before proceeding with investigation, verify the index is current:

```bash
# First check if index exists
if [ ! -d ".claudemem" ] || [ ! -f ".claudemem/index.db" ]; then
  # Use AskUserQuestion to prompt for index creation
  # Options: [1] Create index now (Recommended), [2] Cancel investigation
  exit 1
fi

# Count files modified since last index
STALE_COUNT=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) \
  -newer .claudemem/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | grep -v "dist" | grep -v "build" | wc -l)
STALE_COUNT=$((STALE_COUNT + 0))  # Normalize to integer

if [ "$STALE_COUNT" -gt 0 ]; then
  # Get index time with explicit platform detection
  if [[ "$OSTYPE" == "darwin"* ]]; then
    INDEX_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" .claudemem/index.db 2>/dev/null)
  else
    INDEX_TIME=$(stat -c "%y" .claudemem/index.db 2>/dev/null | cut -d'.' -f1)
  fi
  INDEX_TIME=${INDEX_TIME:-"unknown time"}

  # Get sample of stale files
  STALE_SAMPLE=$(find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -newer .claudemem/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | head -5)

  # Use AskUserQuestion (see template in ultrathink-detective)
fi
```

### Step 4: Index if Needed

```bash
claudemem index
```

---

## Workflow: Bug Investigation (v0.3.0)

### Phase 1: Locate the Symptom

```bash
# Find where the error appears
claudemem --agent map "error message keywords"
# Or find the specific function
claudemem --agent symbol failingFunction```

### Phase 2: Get Full Context

```bash
# Get callers + callees in one command
claudemem --agent context failingFunction```

### Phase 3: Trace Backwards (Find Root Cause)

```bash
# For each caller, check if it's the source
claudemem --agent callers caller1claudemem --agent callers caller2
# Keep tracing until you find the root
```

### Phase 4: Verify the Chain

```bash
# Once you suspect a root cause, verify the path
claudemem --agent callees suspectedRoot
# Does it lead to the symptom?
```

### Phase 5: Check Impact

```bash
# What else calls the buggy code?
claudemem --agent callers buggyFunction
# These are all potentially affected
```

## Output Format: Bug Investigation Report

### 1. Symptom Summary

```
┌─────────────────────────────────────────────────────────┐
│                    BUG INVESTIGATION                     │
├─────────────────────────────────────────────────────────┤
│  Symptom: User sees "undefined" in profile name          │
│  Location: src/components/Profile.tsx:45                │
│  Error Type: Data inconsistency / Null reference         │
│  Actual Type: (from hover)                               │
│  Expected Type: (from calling context)                   │
│  Search Method: claudemem v0.3.0 (AST call chain)       │
└─────────────────────────────────────────────────────────┘
```

### 2. Call Chain Trace

```
❌ SYMPTOM: undefined rendered
   └── src/components/Profile.tsx:45
       └── user.name is undefined

↑ CALLER CHAIN (trace backwards):
   └── useUser hook (src/hooks/useUser.ts:23)
       ↑
   └── fetchUser API (src/api/user.ts:67)
       ↑
   └── userMapper (src/mappers/user.ts:12)
       ↑
🔍 ROOT CAUSE FOUND HERE
```

### 3. Root Cause Analysis

```
🔍 ROOT CAUSE IDENTIFIED:

Location: src/mappers/user.ts:12
Problem: Field name mismatch

API Response:       { fullName: "John Doe" }
Mapper Expects:     { full_name: "..." }
Result:             name = undefined

Evidence:
- callees of fetchUser → userMapper
- callers of userMapper → useUser → Profile
- Complete chain verified via context command
```

### 4. Impact Analysis

```
⚠️ OTHER AFFECTED CODE:

claudemem --agent callers userMapper shows:
  - useUser hook (main app)
  - useAdmin hook (admin panel)
  - tests/user.test.ts

All 3 locations may have the same bug!
```

## Scenarios

### Scenario: Null Pointer Exception

```bash
# Step 1: Find where undefined is used
claudemem --agent map "undefined null"
# Step 2: Get context of the failing function
claudemem --agent context renderProfile
# Step 3: Trace backwards through callers
claudemem --agent callers getUserData
# Step 4: Find where null was introduced
claudemem --agent callees fetchUser```

### Scenario: Race Condition

```bash
# Step 1: Find async operations
claudemem --agent map "async await promise"
# Step 2: Find shared state
claudemem --agent symbol sharedState
# Step 3: Who reads it?
claudemem --agent callers sharedState
# Step 4: Who writes it?
claudemem --agent callees updateState```

### Scenario: Incorrect Behavior

```bash
# Step 1: Find the function with wrong behavior
claudemem --agent symbol calculateTotal
# Step 2: What does it depend on?
claudemem --agent callees calculateTotal
# Step 3: Who provides input?
claudemem --agent callers calculateTotal```

## Result Validation Pattern

After EVERY claudemem command, validate results:

### Context Validation for Debugging

When tracing call chains:

```bash
CONTEXT=$(claudemem --agent context failingFunction)
EXIT_CODE=$?

# Check for failure
if [ "$EXIT_CODE" -ne 0 ]; then
  DIAGNOSIS=$(claudemem status 2>&1)
  # Use AskUserQuestion
fi

# Validate all sections present
if ! echo "$CONTEXT" | grep -q "\[symbol\]"; then
  # Missing symbol section - function not found
  # Use AskUserQuestion: Reindex, Different name, or Cancel
fi

if ! echo "$CONTEXT" | grep -q "\[callers\]"; then
  # Missing callers - may be entry point or index issue
  # Entry points (API handlers, main) have 0 callers - this is expected
fi

if ! echo "$CONTEXT" | grep -q "\[callees\]"; then
  # Missing callees - may be leaf function or index issue
  # Leaf functions (console.log, throw) have 0 callees - this is expected
fi
```

### Empty Results Handling

```bash
CALLERS=$(claudemem --agent callers suspectedBug)

# 0 callers could mean:
# 1. Entry point (main, API handler) - expected
# 2. Dead code - use dead-code command (v0.4.0+)
# 3. Dynamically called - check for import(), eval, reflection

if echo "$CALLERS" | grep -qi "error\|not found"; then
  # Actual error vs no callers
  # Use AskUserQuestion
fi
```

---

## FALLBACK PROTOCOL

**CRITICAL: Never use grep/find/Glob without explicit user approval.**

If claudemem fails or returns irrelevant results:

1. **STOP** - Do not silently switch tools
2. **DIAGNOSE** - Run `claudemem status`
3. **REPORT** - Tell user what happened
4. **ASK** - Use AskUserQuestion for next steps

```typescript
// Fallback options (in order of preference)
AskUserQuestion({
  questions: [{
    question: "claudemem bug investigation failed or found no call chain. How should I proceed?",
    header: "Debugging Issue",
    multiSelect: false,
    options: [
      { label: "Reindex codebase", description: "Run claudemem index (~1-2 min)" },
      { label: "Try different function name", description: "Search for related functions" },
      { label: "Use grep (not recommended)", description: "Traditional search - loses call chain tracing" },
      { label: "Cancel", description: "Stop investigation" }
    ]
  }]
})
```

**See ultrathink-detective skill for complete Fallback Protocol documentation.**

---

## Anti-Patterns

| Anti-Pattern | Why Wrong | Correct Approach |
|--------------|-----------|------------------|
| `grep "error"` | No call relationships | `claudemem --agent context func` |
| Read random files | No direction | Trace callers/callees systematically |
| Fix symptom only | Bug returns | Trace to root cause with `callers` |
| Skip impact check | Miss related bugs | ALWAYS check all `callers` |
| `cmd \| head/tail` | Hides call chain context | Use full output or `--max-depth` |

### Output Truncation Warning

╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║  ❌ Anti-Pattern 7: Truncating Claudemem Output                              ║
║                                                                              ║
║     FORBIDDEN (any form of output truncation):                               ║
║     → BAD: claudemem --agent map "query" | head -80                         ║
║     → BAD: claudemem --agent callers X | tail -50                           ║
║     → BAD: claudemem --agent search "x" | grep -m 10 "y"                    ║
║     → BAD: claudemem --agent map "q" | awk 'NR <= 50'                       ║
║     → BAD: claudemem --agent callers X | sed '50q'                          ║
║     → BAD: claudemem --agent search "x" | sort | head -20                   ║
║     → BAD: claudemem --agent map "q" | grep "pattern" | head -20            ║
║                                                                              ║
║     CORRECT (use full output or built-in limits):                            ║
║     → GOOD: claudemem --agent map "query"                                   ║
║     → GOOD: claudemem --agent search "x" -n 10                              ║
║     → GOOD: claudemem --agent map "q" --tokens 2000                         ║
║     → GOOD: claudemem --agent search "x" --page-size 20 --page 1            ║
║     → GOOD: claudemem --agent context Func --max-depth 3                    ║
║                                                                              ║
║     WHY: Output is pre-optimized; truncation hides critical results         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

---

## Feedback Reporting (v0.8.0+)

After completing investigation, report search feedback to improve future results.

### When to Report

Report feedback ONLY if you used the `search` command during investigation:

| Result Type | Mark As | Reason |
|-------------|---------|--------|
| Read and used | Helpful | Contributed to investigation |
| Read but irrelevant | Unhelpful | False positive |
| Skipped after preview | Unhelpful | Not relevant to query |
| Never read | (Don't track) | Can't evaluate |

### Feedback Pattern

```bash
# Track during investigation
SEARCH_QUERY="your original query"
HELPFUL_IDS=""
UNHELPFUL_IDS=""

# When reading a helpful result
HELPFUL_IDS="$HELPFUL_IDS,$result_id"

# When reading an unhelpful result
UNHELPFUL_IDS="$UNHELPFUL_IDS,$result_id"

# Report at end of investigation (v0.8.0+ only)
if claudemem feedback --help 2>&1 | grep -qi "feedback"; then
  timeout 5 claudemem feedback \
    --query "$SEARCH_QUERY" \
    --helpful "${HELPFUL_IDS#,}" \
    --unhelpful "${UNHELPFUL_IDS#,}" 2>/dev/null || true
fi
```

### Output Update

Include in investigation report:

```
Search Feedback: [X helpful, Y unhelpful] - Submitted (v0.8.0+)
```

---

## Debugging Tips

1. **Start at symptom** - Use `symbol` to find where error appears
2. **Get full context** - Use `context` for callers + callees together
3. **Trace backwards** - Follow `callers` chain to root cause
4. **Verify forward** - Use `callees` to confirm the path
5. **Check impact** - All `callers` of buggy code may be affected

## Notes

- **`context` is your primary tool** - Shows full call chain
- **Trace backwards with `callers`** - Find root cause, not just symptom
- **Verify with `callees`** - Confirm the execution path
- **Check all callers after fixing** - Don't leave other bugs
- Works best with TypeScript, Go, Python, Rust codebases

---

**Maintained by:** MadAppGang
**Plugin:** code-analysis v2.7.0
**Last Updated:** December 2025 (v3.3.0 - Cross-platform compatibility, inline templates, improved validation)
