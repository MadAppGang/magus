# Claudemem Skill Improvements Design Document

**Version:** 1.0.0
**Status:** Design Complete - Ready for Implementation
**Date:** December 2025
**Plugin:** code-analysis v2.6.0 -> v2.7.0

## Executive Summary

This document defines comprehensive improvements to the detective skills that use claudemem for semantic code search. The improvements address three critical gaps:

1. **Index Freshness Check** - Detect stale indexes before investigation
2. **Result Quality Validation** - Validate relevance of claudemem results
3. **Explicit Fallback Policy** - Never silently switch to forbidden tools

**Key Principle:** All fallback decisions require explicit user approval via AskUserQuestion.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Shared Components](#shared-components)
3. [Index Freshness Check (Phase 0.5)](#index-freshness-check-phase-05)
4. [Result Quality Validation](#result-quality-validation)
5. [Explicit Fallback Policy](#explicit-fallback-policy)
6. [Per-Skill Modifications](#per-skill-modifications)
7. [AskUserQuestion Templates](#askuserquestion-templates)
8. [Error Messages](#error-messages)
9. [Testing Strategy](#testing-strategy)
10. [Implementation Checklist](#implementation-checklist)

---

## Architecture Overview

### Current State (v2.6.0)

```
PHASE 0: Setup
  Step 1: Verify claudemem version
  Step 2: If not installed -> AskUserQuestion (install options)
  Step 3: Check index status
  Step 4: Index if needed

PHASES 1-N: Investigation
  Uses claudemem commands without validation
  If claudemem fails -> undefined behavior (may silently use grep)
```

### Target State (v2.7.0)

```
PHASE 0: Setup
  Step 1: Verify claudemem version (v0.3.0+ required)
  Step 2: If not installed -> AskUserQuestion (install options)
  Step 3: Check index status

PHASE 0.5: Index Freshness Check (NEW)
  Step 1: Count files modified since last index
  Step 2: If stale files > 0 -> AskUserQuestion (reindex/proceed/cancel)
  Step 3: If reindex chosen -> Run claudemem index

PHASES 1-N: Investigation (with validation)
  After EVERY claudemem command:
    1. Check if results are empty
    2. Validate result relevance to query
    3. If irrelevant -> AskUserQuestion (reindex/rephrase/fallback)

  On ANY claudemem failure:
    1. Run claudemem status (diagnose)
    2. Report error to user
    3. AskUserQuestion (never silent fallback)
```

### Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SKILL ARCHITECTURE (v2.7.0)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    SHARED VALIDATION LAYER (NEW)                     │   │
│  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐  │   │
│  │  │ Index         │ │ Result        │ │ Fallback                  │  │   │
│  │  │ Freshness     │ │ Quality       │ │ Protocol                  │  │   │
│  │  │ Checker       │ │ Validator     │ │ Handler                   │  │   │
│  │  └───────────────┘ └───────────────┘ └───────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        DETECTIVE SKILLS                              │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐       │   │
│  │  │ ultrathink │ │ architect  │ │ developer  │ │ tester     │       │   │
│  │  │ detective  │ │ detective  │ │ detective  │ │ detective  │       │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘       │   │
│  │  ┌────────────┐ ┌────────────┐                                      │   │
│  │  │ debugger   │ │ claudemem  │                                      │   │
│  │  │ detective  │ │ search     │                                      │   │
│  │  └────────────┘ └────────────┘                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     CLAUDEMEM CLI (v0.3.0+)                          │   │
│  │  map | symbol | callers | callees | context | search                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Shared Components

All detective skills will use these shared bash functions for consistent behavior.

### 1. Index Freshness Checker

```bash
# Function: check_index_freshness
# Purpose: Detect files modified since last claudemem index
# Returns: Count of stale files, sets INDEX_TIME and STALE_FILES variables

check_index_freshness() {
  local project_root="${1:-.}"

  # Check if index exists
  if [ ! -d "$project_root/.claudemem" ] || [ ! -f "$project_root/.claudemem/index.db" ]; then
    echo "ERROR: No claudemem index found. Run: claudemem index"
    return 1
  fi

  # Get index modification time
  INDEX_DB="$project_root/.claudemem/index.db"
  INDEX_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M:%S" "$INDEX_DB" 2>/dev/null || \
               stat -c "%y" "$INDEX_DB" 2>/dev/null | cut -d'.' -f1)

  # Count files modified since index
  STALE_FILES=$(find "$project_root" -type f \( \
    -name "*.ts" -o -name "*.tsx" -o \
    -name "*.js" -o -name "*.jsx" -o \
    -name "*.py" -o \
    -name "*.go" -o \
    -name "*.rs" \
  \) -newer "$INDEX_DB" 2>/dev/null | \
    grep -v "node_modules" | \
    grep -v ".git" | \
    grep -v "dist" | \
    grep -v "build" | \
    wc -l | tr -d ' ')

  echo "$STALE_FILES"
}

# Function: get_stale_file_list
# Purpose: List actual stale files for user context
# Returns: List of stale file paths (max 10)

get_stale_file_list() {
  local project_root="${1:-.}"
  local limit="${2:-10}"
  local index_db="$project_root/.claudemem/index.db"

  find "$project_root" -type f \( \
    -name "*.ts" -o -name "*.tsx" -o \
    -name "*.js" -o -name "*.jsx" -o \
    -name "*.py" -o \
    -name "*.go" -o \
    -name "*.rs" \
  \) -newer "$index_db" 2>/dev/null | \
    grep -v "node_modules" | \
    grep -v ".git" | \
    grep -v "dist" | \
    grep -v "build" | \
    head -n "$limit"
}
```

### 2. Result Quality Validator

```bash
# Function: validate_claudemem_results
# Purpose: Check if results are relevant to the query
# Parameters: $1 = query, $2 = results (raw output)
# Returns: 0 if valid, 1 if empty, 2 if irrelevant

validate_claudemem_results() {
  local query="$1"
  local results="$2"
  local validation_mode="${3:-basic}"  # basic | strict

  # Check 1: Empty results
  if [ -z "$results" ]; then
    echo "EMPTY"
    return 1
  fi

  # Check 2: Error in results
  if echo "$results" | grep -qi "error\|not found\|no results\|no matches"; then
    echo "ERROR"
    return 1
  fi

  # Check 3: Relevance check (basic mode)
  if [ "$validation_mode" = "basic" ]; then
    # Extract query keywords (words > 3 chars)
    KEYWORDS=$(echo "$query" | tr '[:upper:]' '[:lower:]' | \
      grep -oE '\b[a-z]{3,}\b' | sort -u)

    # Check if ANY keyword appears in results
    MATCH_COUNT=0
    for kw in $KEYWORDS; do
      if echo "$results" | tr '[:upper:]' '[:lower:]' | grep -q "$kw"; then
        MATCH_COUNT=$((MATCH_COUNT + 1))
      fi
    done

    if [ "$MATCH_COUNT" -eq 0 ]; then
      echo "IRRELEVANT"
      return 2
    fi
  fi

  # Check 4: Relevance check (strict mode - requires 50%+ keyword match)
  if [ "$validation_mode" = "strict" ]; then
    KEYWORDS=$(echo "$query" | tr '[:upper:]' '[:lower:]' | \
      grep -oE '\b[a-z]{3,}\b' | sort -u)
    KEYWORD_COUNT=$(echo "$KEYWORDS" | wc -w | tr -d ' ')

    MATCH_COUNT=0
    for kw in $KEYWORDS; do
      if echo "$results" | tr '[:upper:]' '[:lower:]' | grep -q "$kw"; then
        MATCH_COUNT=$((MATCH_COUNT + 1))
      fi
    done

    # Require at least 50% keyword match
    THRESHOLD=$((KEYWORD_COUNT / 2))
    if [ "$MATCH_COUNT" -lt "$THRESHOLD" ] && [ "$THRESHOLD" -gt 0 ]; then
      echo "IRRELEVANT"
      return 2
    fi
  fi

  echo "VALID"
  return 0
}

# Function: extract_result_summary
# Purpose: Extract key information from results for user display
# Parameters: $1 = results (raw output)
# Returns: Summary string

extract_result_summary() {
  local results="$1"

  # Count symbols found
  SYMBOL_COUNT=$(echo "$results" | grep -c "^name:" || echo "0")

  # Get unique files
  FILE_COUNT=$(echo "$results" | grep "^file:" | sort -u | wc -l | tr -d ' ')

  # Get top symbols by PageRank (if available)
  TOP_SYMBOLS=$(echo "$results" | grep "^name:" | head -3 | cut -d: -f2 | tr '\n' ', ')

  echo "Found: ${SYMBOL_COUNT} symbols in ${FILE_COUNT} files"
  if [ -n "$TOP_SYMBOLS" ]; then
    echo "Top matches: ${TOP_SYMBOLS%,}"
  fi
}
```

### 3. Fallback Protocol Handler

```bash
# Function: handle_claudemem_failure
# Purpose: Diagnose failure and prepare user prompt
# Parameters: $1 = command that failed, $2 = error message
# Returns: Diagnostic info string

handle_claudemem_failure() {
  local failed_command="$1"
  local error_msg="$2"

  # Diagnose: Check claudemem status
  DIAGNOSIS=$(claudemem status 2>&1 || echo "Status check failed")

  # Check if index exists
  if [ ! -d ".claudemem" ]; then
    DIAGNOSIS="Index not found. Project needs indexing."
  fi

  # Check if index is corrupted
  if echo "$DIAGNOSIS" | grep -qi "corrupt\|invalid"; then
    DIAGNOSIS="Index may be corrupted. Re-indexing recommended."
  fi

  # Format diagnostic output
  cat << EOF
CLAUDEMEM FAILURE REPORT
========================
Command: $failed_command
Error: $error_msg

Diagnosis:
$DIAGNOSIS

Possible causes:
1. Index is stale (code changed since indexing)
2. Symbol/query not in codebase
3. Index needs rebuilding
4. claudemem version incompatibility
EOF
}

# Function: never_silent_fallback
# Purpose: CRITICAL - Ensures fallback is NEVER silent
# This is a guard function that should wrap any potential fallback

never_silent_fallback() {
  local reason="$1"

  # This function exists to document the principle
  # It should NEVER be called in automated fallback scenarios
  # Instead, AskUserQuestion MUST be used

  echo "ERROR: Silent fallback attempted!"
  echo "Reason: $reason"
  echo ""
  echo "CRITICAL: grep/find/glob are FORBIDDEN."
  echo "You MUST use AskUserQuestion to get explicit user permission."

  return 1
}
```

---

## Index Freshness Check (Phase 0.5)

### Integration Point

Add between current Step 3 and Step 4 in all detective skills.

### Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PHASE 0.5: INDEX FRESHNESS CHECK                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Step 1: Count Modified Files                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  STALE_COUNT=$(check_index_freshness)                               │   │
│  │  Index last updated: 2025-12-27 10:30:45                            │   │
│  │  Files modified since: 23                                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Step 2: If STALE_COUNT > 0 → AskUserQuestion                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  "23 files modified since last index (2025-12-27 10:30)."           │   │
│  │  "Results may be incomplete or outdated."                           │   │
│  │                                                                      │   │
│  │  Recently modified files:                                           │   │
│  │    - src/services/auth.ts                                           │   │
│  │    - src/controllers/user.ts                                        │   │
│  │    - src/utils/validation.ts                                        │   │
│  │    ... and 20 more                                                  │   │
│  │                                                                      │   │
│  │  Options:                                                           │   │
│  │    [1] Reindex now (Recommended) - Takes ~1-2 min                   │   │
│  │    [2] Proceed with stale index - May miss recent changes           │   │
│  │    [3] Cancel - I'll investigate manually                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Step 3: Handle User Choice                                                 │
│    [1] → Run: claudemem index → Continue to PHASE 1                        │
│    [2] → Continue with warning banner                                       │
│    [3] → Exit investigation                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Implementation (Skill Addition)

Add this section to all detective skills after Step 3 (Check Index Status):

```markdown
### Step 3.5: Check Index Freshness

```bash
# Count files modified since last index
STALE_COUNT=$(check_index_freshness)
INDEX_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" .claudemem/index.db 2>/dev/null || \
             stat -c "%y" .claudemem/index.db 2>/dev/null | cut -d'.' -f1)

if [ "$STALE_COUNT" -gt 0 ]; then
  STALE_FILES=$(get_stale_file_list . 5)

  # Trigger AskUserQuestion (see Templates section)
  # Do NOT proceed without user decision
fi
```

**If user selects "Proceed with stale index"**, display warning banner:

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  WARNING: Index is stale ($STALE_COUNT files modified since $INDEX_TIME)     ║
║  Results may not reflect recent code changes.                                ║
╚══════════════════════════════════════════════════════════════════════════════╝
```
```

---

## Result Quality Validation

### Validation Points

After EVERY claudemem command that returns results:

1. **map** - Validate results contain relevant symbols
2. **symbol** - Validate symbol was found
3. **callers** - Validate callers list is sensible
4. **callees** - Validate callees list is sensible
5. **context** - Validate all sections present
6. **search** - Validate results match query semantically

### Validation Workflow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      RESULT QUALITY VALIDATION WORKFLOW                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  After EVERY claudemem command:                                             │
│                                                                             │
│  Step 1: Execute Command                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  RESULTS=$(claudemem --agent map "authentication")           │   │
│  │  EXIT_CODE=$?                                                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Step 2: Check Exit Code                                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  if [ "$EXIT_CODE" -ne 0 ]; then                                    │   │
│  │    handle_claudemem_failure "map" "$RESULTS"                        │   │
│  │    → AskUserQuestion (failure recovery options)                     │   │
│  │  fi                                                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Step 3: Validate Results                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  VALIDATION=$(validate_claudemem_results "authentication" "$RESULTS")│   │
│  │                                                                      │   │
│  │  case "$VALIDATION" in                                              │   │
│  │    "VALID")   → Continue with results                               │   │
│  │    "EMPTY")   → AskUserQuestion (no results options)                │   │
│  │    "IRRELEVANT") → AskUserQuestion (irrelevant results options)     │   │
│  │  esac                                                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              ↓                                              │
│  Step 4: Proceed or Recover                                                 │
│    VALID → Use results, continue investigation                              │
│    EMPTY/IRRELEVANT → User chooses: reindex, rephrase, or fallback         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Example: Irrelevant Results Detection

**Scenario:** User asks "find install opencode" but claudemem returns "ChunkType, CodeChunk"

```bash
# Query
QUERY="install opencode"
RESULTS=$(claudemem --agent map "$QUERY")

# Results (irrelevant)
# file: src/types/chunk.ts
# name: ChunkType
# pagerank: 0.023
# ---
# file: src/types/chunk.ts
# name: CodeChunk
# pagerank: 0.019

# Validation
VALIDATION=$(validate_claudemem_results "$QUERY" "$RESULTS")
# Returns: "IRRELEVANT" (no keywords match: "install", "opencode")

# Trigger AskUserQuestion for irrelevant results
```

---

## Explicit Fallback Policy

### Core Principle

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

### Fallback Decision Tree

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FALLBACK DECISION TREE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  claudemem command executed                                                 │
│         │                                                                   │
│         ├─── Success + Valid Results                                        │
│         │         └── Continue investigation                                │
│         │                                                                   │
│         ├─── Success + Empty Results                                        │
│         │         └── AskUserQuestion:                                      │
│         │               [1] Try different query                             │
│         │               [2] Check if symbol exists (typo?)                  │
│         │               [3] Reindex codebase                                │
│         │               [4] Use grep (LAST RESORT - explain risks)          │
│         │                                                                   │
│         ├─── Success + Irrelevant Results                                   │
│         │         └── AskUserQuestion:                                      │
│         │               [1] Reindex codebase (Recommended)                  │
│         │               [2] Try different query (rephrase)                  │
│         │               [3] Use grep (LAST RESORT - explain risks)          │
│         │                                                                   │
│         └─── Failure (exit code != 0)                                       │
│                   └── handle_claudemem_failure()                            │
│                   └── AskUserQuestion:                                      │
│                         [1] Reindex codebase                                │
│                         [2] Check claudemem installation                    │
│                         [3] Cancel investigation                            │
│                         [4] Use grep (LAST RESORT)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Grep Fallback Warning

If user explicitly chooses grep fallback, display this warning:

```markdown
## WARNING: Using Fallback Search (grep)

You have chosen to use grep as a fallback. Please understand the limitations:

| Feature | claudemem | grep |
|---------|-----------|------|
| Semantic understanding | Yes | No |
| Call graph analysis | Yes | No |
| Symbol relationships | Yes | No |
| PageRank ranking | Yes | No |
| False positives | Low | High |

**Recommendation:** After completing this task, run `claudemem index` to rebuild
the index for future investigations.

Proceeding with grep...
```

---

## Per-Skill Modifications

### Common Changes for All Skills

Add these sections to each detective skill:

#### 1. Add to PHASE 0 (after Step 3)

```markdown
### Step 3.5: Index Freshness Check

Before proceeding with investigation, verify the index is current:

```bash
# Check index freshness
STALE_COUNT=$(find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) \
  -newer .claudemem/index.db 2>/dev/null | grep -v "node_modules" | grep -v ".git" | wc -l | tr -d ' ')

if [ "$STALE_COUNT" -gt 0 ]; then
  # Get index time
  INDEX_TIME=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" .claudemem/index.db 2>/dev/null)

  # Get sample of stale files
  STALE_SAMPLE=$(find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
    -newer .claudemem/index.db 2>/dev/null | grep -v "node_modules" | head -5)

  # Ask user how to proceed (see AskUserQuestion templates)
fi
```

**If user selects "Proceed with stale index"**, display warning banner in output.
```

#### 2. Add Result Validation Pattern

Add this wrapper pattern for claudemem commands:

```markdown
### Result Validation Pattern

After EVERY claudemem command, validate results:

```bash
# Execute command
RESULTS=$(claudemem --agent [command] [args])
EXIT_CODE=$?

# Check for failure
if [ "$EXIT_CODE" -ne 0 ]; then
  # Diagnose and ask user
  DIAGNOSIS=$(claudemem status 2>&1)
  # -> AskUserQuestion (failure recovery)
fi

# Validate relevance
KEYWORDS="[extracted from query]"
MATCH_COUNT=0
for kw in $KEYWORDS; do
  if echo "$RESULTS" | grep -qi "$kw"; then
    MATCH_COUNT=$((MATCH_COUNT + 1))
  fi
done

if [ "$MATCH_COUNT" -eq 0 ]; then
  # Results don't match query
  # -> AskUserQuestion (irrelevant results)
fi
```
```

#### 3. Add Fallback Protocol Section

```markdown
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
    question: "[Explain what happened]. How should I proceed?",
    header: "Investigation Issue",
    multiSelect: false,
    options: [
      { label: "Reindex codebase", description: "Run claudemem index (~1-2 min)" },
      { label: "Try different query", description: "Rephrase the search" },
      { label: "Use grep (not recommended)", description: "Traditional search - loses semantic understanding" },
      { label: "Cancel", description: "Stop investigation" }
    ]
  }]
})
```
```

### Skill-Specific Additions

#### ultrathink-detective

Add to Multi-Dimensional Analysis Framework:

```markdown
### Validation Per Dimension

Each dimension MUST validate its claudemem results:

**Dimension 1: Architecture (map)**
```bash
RESULTS=$(claudemem --agent map)
if [ -z "$RESULTS" ]; then
  # Empty index - ask user about indexing
fi
# Validate PageRank values present
if ! echo "$RESULTS" | grep -q "pagerank:"; then
  # Index may be corrupted or outdated
fi
```

**Dimension 3: Test Coverage (callers)**
```bash
RESULTS=$(claudemem --agent callers $FUNCTION)
# Even 0 callers is valid - but validate it's not an error
if echo "$RESULTS" | grep -qi "error\|not found"; then
  # Actual error vs no callers
fi
```
```

#### architect-detective

Add to Architecture Discovery section:

```markdown
### Map Command Validation

After `map` commands, validate architectural symbols were found:

```bash
RESULTS=$(claudemem --agent map "service layer business logic")

# Check for high-PageRank symbols (> 0.01)
HIGH_PR=$(echo "$RESULTS" | grep "pagerank:" | awk -F': ' '{if ($2 > 0.01) print}' | wc -l)

if [ "$HIGH_PR" -eq 0 ]; then
  # No architectural symbols found - may be wrong query or index issue
  # -> AskUserQuestion
fi
```
```

#### developer-detective

Add to Implementation Investigation section:

```markdown
### Symbol/Callers Validation

When tracing implementation:

```bash
# Find symbol
SYMBOL=$(claudemem --agent symbol PaymentService)
if [ -z "$SYMBOL" ] || echo "$SYMBOL" | grep -qi "not found"; then
  # Symbol doesn't exist or typo
  # -> AskUserQuestion with suggestions
fi

# Check callers
CALLERS=$(claudemem --agent callers PaymentService)
# 0 callers is valid (entry point or unused)
# But error message is not
```
```

#### tester-detective

Add to Test Coverage Analysis section:

```markdown
### Callers Validation for Tests

When checking test coverage:

```bash
CALLERS=$(claudemem --agent callers processPayment)

# Validate we got callers, not an error
if echo "$CALLERS" | grep -qi "error\|failed"; then
  # -> AskUserQuestion
fi

# Count test vs production callers
TEST_CALLERS=$(echo "$CALLERS" | grep -E "\.test\.|\.spec\.|_test\." | wc -l)
PROD_CALLERS=$(echo "$CALLERS" | grep -v -E "\.test\.|\.spec\.|_test\." | wc -l)

# Report coverage ratio
```
```

#### debugger-detective

Add to Bug Investigation section:

```markdown
### Context Validation for Debugging

When tracing call chains:

```bash
CONTEXT=$(claudemem --agent context failingFunction)

# Validate all sections present
if ! echo "$CONTEXT" | grep -q "\[symbol\]"; then
  # Missing symbol section - function not found
  # -> AskUserQuestion
fi

if ! echo "$CONTEXT" | grep -q "\[callers\]"; then
  # Missing callers - may be entry point or index issue
fi

if ! echo "$CONTEXT" | grep -q "\[callees\]"; then
  # Missing callees - may be leaf function or index issue
fi
```
```

#### claudemem-search

Add new section after Quality Checklist:

```markdown
## Result Validation Guidelines

### After Every Command

1. **Check exit code** - Non-zero indicates failure
2. **Check for empty results** - May need reindex or different query
3. **Validate relevance** - Results should match query semantics

### Validation Examples

```bash
# map validation
RESULTS=$(claudemem --agent map "authentication")
if ! echo "$RESULTS" | grep -qi "auth\|login\|user\|session"; then
  echo "WARNING: Results may not be relevant to authentication query"
fi

# symbol validation
RESULTS=$(claudemem --agent symbol UserService)
if ! echo "$RESULTS" | grep -q "name: UserService"; then
  echo "WARNING: UserService not found - check spelling"
fi

# search validation
RESULTS=$(claudemem --agent search "error handling")
MATCH_COUNT=0
for kw in error handling catch try; do
  if echo "$RESULTS" | grep -qi "$kw"; then
    MATCH_COUNT=$((MATCH_COUNT + 1))
  fi
done
if [ "$MATCH_COUNT" -lt 2 ]; then
  echo "WARNING: Results may not be relevant to error handling query"
fi
```
```

---

## AskUserQuestion Templates

### Template 1: Stale Index

```typescript
AskUserQuestion({
  questions: [{
    question: `${STALE_COUNT} files have been modified since the last index (${INDEX_TIME}). The claudemem index may be outdated, which could cause missing or incorrect results. How would you like to proceed?`,
    header: "Index Freshness Warning",
    multiSelect: false,
    options: [
      {
        label: "Reindex now (Recommended)",
        description: "Run claudemem index to update. Takes ~1-2 minutes."
      },
      {
        label: "Proceed with stale index",
        description: "Continue investigation. May miss recent code changes."
      },
      {
        label: "Cancel investigation",
        description: "I'll handle this manually."
      }
    ]
  }]
})
```

### Template 2: Empty Results

```typescript
AskUserQuestion({
  questions: [{
    question: `claudemem returned no results for "${QUERY}". This could mean: (1) no matching code exists, (2) the index is outdated, or (3) the query needs rephrasing. How would you like to proceed?`,
    header: "No Results Found",
    multiSelect: false,
    options: [
      {
        label: "Try different query",
        description: "Rephrase the search terms"
      },
      {
        label: "Reindex codebase",
        description: "Update claudemem index and retry"
      },
      {
        label: "List available symbols",
        description: "Run claudemem map to see what's indexed"
      },
      {
        label: "Use grep (last resort)",
        description: "Traditional search - loses semantic analysis"
      },
      {
        label: "Cancel",
        description: "Stop this investigation"
      }
    ]
  }]
})
```

### Template 3: Irrelevant Results

```typescript
AskUserQuestion({
  questions: [{
    question: `claudemem returned results that don't appear relevant to your query "${QUERY}". Found: ${RESULT_SUMMARY}. This often indicates a stale index or query mismatch. How would you like to proceed?`,
    header: "Potentially Irrelevant Results",
    multiSelect: false,
    options: [
      {
        label: "Reindex codebase (Recommended)",
        description: "Update index to capture recent changes"
      },
      {
        label: "Try different query",
        description: "Rephrase with different terms"
      },
      {
        label: "Proceed anyway",
        description: "Use these results despite relevance concerns"
      },
      {
        label: "Use grep (last resort)",
        description: "Traditional search - loses semantic understanding"
      }
    ]
  }]
})
```

### Template 4: Command Failure

```typescript
AskUserQuestion({
  questions: [{
    question: `claudemem command failed: ${ERROR_MESSAGE}. Diagnosis: ${DIAGNOSIS}. How would you like to proceed?`,
    header: "claudemem Error",
    multiSelect: false,
    options: [
      {
        label: "Reindex codebase",
        description: "Rebuild the index from scratch"
      },
      {
        label: "Check claudemem installation",
        description: "Verify claudemem is installed and configured"
      },
      {
        label: "Use grep (last resort)",
        description: "Traditional search - loses all claudemem benefits"
      },
      {
        label: "Cancel",
        description: "Stop investigation"
      }
    ]
  }]
})
```

### Template 5: Grep Fallback Confirmation

```typescript
AskUserQuestion({
  questions: [{
    question: `You've chosen to use grep as a fallback. This will lose: semantic understanding, call graph analysis, symbol relationships, and PageRank ranking. Are you sure you want to proceed with grep?`,
    header: "Fallback Confirmation",
    multiSelect: false,
    options: [
      {
        label: "Yes, use grep",
        description: "I understand the limitations"
      },
      {
        label: "No, try reindexing first",
        description: "Let me fix claudemem instead"
      },
      {
        label: "No, cancel",
        description: "I'll investigate differently"
      }
    ]
  }]
})
```

---

## Error Messages

### User-Friendly Diagnostic Messages

#### Index Not Found

```
CLAUDEMEM INDEX NOT FOUND
=========================
The claudemem index does not exist for this project.

This means:
- No semantic code search is available
- Call graph analysis is not possible
- PageRank ranking is not available

Solution: Run 'claudemem index' to create the index (~1-2 minutes)
```

#### Stale Index Warning

```
INDEX MAY BE OUTDATED
=====================
Index last updated: ${INDEX_TIME}
Files modified since: ${STALE_COUNT}

Recently modified files:
${STALE_FILE_LIST}

Investigation results may be incomplete or incorrect.
Recommendation: Run 'claudemem index' before investigating.
```

#### No Results Found

```
NO MATCHING CODE FOUND
======================
Query: "${QUERY}"
Results: 0 matches

Possible reasons:
1. No code matches this query
2. Index is outdated (missing new code)
3. Query terms need rephrasing
4. Code uses different terminology

Suggestions:
- Try broader terms (e.g., "auth" instead of "authenticateUser")
- Run 'claudemem index' to update
- Use 'claudemem map' to see what's indexed
```

#### Irrelevant Results Warning

```
RESULTS MAY NOT BE RELEVANT
============================
Query: "${QUERY}"
Expected: Code related to ${QUERY}
Found: ${RESULT_SUMMARY}

The results don't appear to match your query. This often happens when:
1. Index is stale (doesn't reflect recent changes)
2. Query uses different terms than the code
3. Semantic understanding gap

Recommendation: Reindex the codebase or try different query terms.
```

#### Command Failure

```
CLAUDEMEM COMMAND FAILED
========================
Command: ${FAILED_COMMAND}
Error: ${ERROR_MESSAGE}

Diagnostic Information:
${DIAGNOSIS}

Possible causes:
1. Index corruption - try rebuilding with 'claudemem index --force'
2. Version mismatch - ensure claudemem v0.3.0+
3. API key issue - check OpenRouter configuration
4. File access issue - verify project permissions

Do NOT fall back to grep/find without explicit approval.
```

---

## Testing Strategy

### Test Categories

#### 1. Unit Tests for Validation Functions

```bash
# test_index_freshness.sh

test_empty_index() {
  rm -rf .claudemem
  RESULT=$(check_index_freshness)
  assert_contains "$RESULT" "ERROR"
}

test_fresh_index() {
  claudemem index
  sleep 1
  RESULT=$(check_index_freshness)
  assert_equals "$RESULT" "0"
}

test_stale_index() {
  claudemem index
  sleep 1
  touch src/test.ts
  RESULT=$(check_index_freshness)
  assert_greater_than "$RESULT" "0"
}
```

```bash
# test_result_validation.sh

test_empty_results() {
  RESULT=$(validate_claudemem_results "auth" "")
  assert_equals "$RESULT" "EMPTY"
}

test_valid_results() {
  RESULTS="file: src/auth.ts
name: AuthService
pagerank: 0.05"
  RESULT=$(validate_claudemem_results "auth" "$RESULTS")
  assert_equals "$RESULT" "VALID"
}

test_irrelevant_results() {
  RESULTS="file: src/chunk.ts
name: ChunkType
pagerank: 0.02"
  RESULT=$(validate_claudemem_results "auth" "$RESULTS")
  assert_equals "$RESULT" "IRRELEVANT"
}
```

#### 2. Integration Tests

```bash
# test_detective_flow.sh

test_stale_index_triggers_prompt() {
  # Setup: Create index, modify file
  claudemem index
  echo "// modified" >> src/test.ts

  # Execute detective skill (simulate)
  # Verify AskUserQuestion would be triggered
  STALE=$(check_index_freshness)
  assert_greater_than "$STALE" "0"
}

test_irrelevant_results_trigger_prompt() {
  claudemem index

  # Query for something that won't match
  RESULTS=$(claudemem --agent map "xyznonexistent")
  VALIDATION=$(validate_claudemem_results "xyznonexistent" "$RESULTS")

  # Should trigger irrelevant/empty prompt
  assert_in "$VALIDATION" "EMPTY" "IRRELEVANT"
}
```

#### 3. Manual Test Scenarios

| Scenario | Setup | Expected Behavior |
|----------|-------|-------------------|
| Fresh index | Run `claudemem index`, then detective | No freshness warning |
| Stale index (1 file) | Index, modify 1 file, detective | Warning with 1 stale file |
| Stale index (10+ files) | Index, modify 10 files, detective | Warning showing sample files |
| No results | Query for non-existent symbol | "No Results" AskUserQuestion |
| Irrelevant results | Query "auth" in math-only codebase | "Irrelevant Results" AskUserQuestion |
| Command failure | Corrupt .claudemem/index.db | Failure diagnostic + AskUserQuestion |
| User selects reindex | Choose "Reindex now" | Runs claudemem index, continues |
| User selects proceed | Choose "Proceed with stale" | Warning banner, continues |
| User selects grep | Choose "Use grep" | Confirmation prompt, then grep |
| User cancels | Choose "Cancel" | Investigation stops cleanly |

#### 4. Edge Case Tests

```bash
# test_edge_cases.sh

test_large_stale_count() {
  # 1000+ modified files
  claudemem index
  for i in $(seq 1 100); do
    touch "src/test_$i.ts"
  done

  STALE=$(check_index_freshness)
  # Should still work, show sample
  assert_greater_than "$STALE" "99"
}

test_special_characters_in_query() {
  # Query with special chars
  RESULTS=$(claudemem --agent map "user.name")
  VALIDATION=$(validate_claudemem_results "user.name" "$RESULTS")
  # Should not break validation
}

test_unicode_in_results() {
  # Results with unicode
  RESULTS="file: src/i18n.ts
name: translateMessage
pagerank: 0.01
docstring: Translates messages with unicode support"
  VALIDATION=$(validate_claudemem_results "translate" "$RESULTS")
  assert_equals "$VALIDATION" "VALID"
}

test_very_long_results() {
  # Results with 1000+ lines
  RESULTS=$(claudemem --agent map)
  # Validation should handle without timeout
  VALIDATION=$(timeout 5s validate_claudemem_results "code" "$RESULTS")
  assert_not_empty "$VALIDATION"
}
```

---

## Implementation Checklist

### Phase 1: Shared Components

- [ ] Create `shared/validation.sh` with all validation functions
- [ ] Create `shared/prompts.ts` with AskUserQuestion templates
- [ ] Create `shared/messages.md` with error message templates
- [ ] Unit test all validation functions
- [ ] Integration test validation flow

### Phase 2: Skill Updates

- [ ] Update `ultrathink-detective/SKILL.md`
  - [ ] Add Phase 0.5 (Index Freshness)
  - [ ] Add result validation per dimension
  - [ ] Add fallback protocol section
- [ ] Update `architect-detective/SKILL.md`
  - [ ] Add Phase 0.5
  - [ ] Add map command validation
  - [ ] Add fallback protocol
- [ ] Update `developer-detective/SKILL.md`
  - [ ] Add Phase 0.5
  - [ ] Add symbol/callers validation
  - [ ] Add fallback protocol
- [ ] Update `tester-detective/SKILL.md`
  - [ ] Add Phase 0.5
  - [ ] Add callers validation for tests
  - [ ] Add fallback protocol
- [ ] Update `debugger-detective/SKILL.md`
  - [ ] Add Phase 0.5
  - [ ] Add context validation
  - [ ] Add fallback protocol
- [ ] Update `claudemem-search/SKILL.md`
  - [ ] Add Phase 0.5
  - [ ] Add result validation guidelines
  - [ ] Add fallback protocol

### Phase 3: Testing

- [ ] Write unit tests for validation functions
- [ ] Write integration tests for detective flow
- [ ] Execute manual test scenarios
- [ ] Document any edge cases discovered
- [ ] Fix bugs found during testing

### Phase 4: Documentation

- [ ] Update CLAUDE.md with new validation behavior
- [ ] Update plugin README
- [ ] Update CHANGELOG for v2.7.0
- [ ] Create migration guide (if needed)

### Phase 5: Release

- [ ] Bump version: code-analysis v2.6.0 -> v2.7.0
- [ ] Update marketplace.json
- [ ] Create git tag: plugins/code-analysis/v2.7.0
- [ ] Verify installation works
- [ ] Monitor for issues

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-27 | Initial design document |

---

**Designed by:** Agent Designer
**For:** code-analysis plugin v2.7.0
**Status:** Ready for implementation
