# Claudemem Search Feedback Protocol Design

**Version:** 1.0.0
**Status:** Design Document
**Created:** December 2025
**Purpose:** Add per-project learning feedback mechanism to all claudemem-using files in code-analysis plugin

---

## Executive Summary

This design document outlines the implementation of claudemem's search feedback protocol across all relevant skills, agents, and commands in the code-analysis plugin. The feedback mechanism enables per-project learning where:

- **Helpful IDs** boost files in future searches (+10% per feedback)
- **Unhelpful IDs** demote files (-10% per feedback)
- Weights are stored in `.claudemem/index.db`

---

## Table of Contents

1. [Overview](#overview)
2. [Files to Modify](#files-to-modify)
3. [Core Pattern Design](#core-pattern-design)
4. [Skill-Specific Changes](#skill-specific-changes)
5. [Agent-Specific Changes](#agent-specific-changes)
6. [Orchestration Changes](#orchestration-changes)
7. [CLI vs MCP Interfaces](#cli-vs-mcp-interfaces)
8. [Implementation Templates](#implementation-templates)
9. [Impact Assessment](#impact-assessment)
10. [Testing Strategy](#testing-strategy)

---

## Overview

### What is Search Feedback?

Claudemem's feedback mechanism creates a learning loop:

```
┌─────────────────────────────────────────────────────────────────┐
│                    FEEDBACK LEARNING LOOP                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. SEARCH: claudemem search "authentication" -n 10             │
│     → Returns results with IDs: abc123, def456, ghi789...       │
│                                                                  │
│  2. USE: Agent reads abc123 (auth middleware), def456 (login)   │
│     → These were helpful for the task                           │
│                                                                  │
│  3. SKIP: Agent ignores ghi789 (unrelated test fixtures)        │
│     → This was unhelpful/irrelevant                             │
│                                                                  │
│  4. FEEDBACK: Report which results were helpful/unhelpful       │
│     claudemem feedback --query "auth" \                         │
│       --helpful abc123,def456 --unhelpful ghi789                │
│                                                                  │
│  5. LEARN: Next search for "authentication" will:               │
│     → Rank abc123, def456 higher (+10%)                         │
│     → Rank ghi789 lower (-10%)                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Non-Blocking** - Feedback should not block workflows; failures are logged but don't halt execution
2. **End-of-Workflow** - Feedback is reported after investigation completes, not during
3. **Result ID Tracking** - Agents must track which result IDs they actually read/used
4. **Dual Interface** - Support both CLI and MCP depending on execution context
5. **Encouraged but Optional** - Feedback improves results but is not mandatory

---

## Files to Modify

### Primary Files (11 total)

| File | Type | Priority | Current Lines | Changes |
|------|------|----------|---------------|---------|
| `skills/claudemem-search/SKILL.md` | Skill | P0 - Critical | ~1530 | Add feedback section, update workflow |
| `agents/codebase-detective.md` | Agent | P0 - Critical | ~406 | Add feedback phase to workflow |
| `skills/developer-detective/SKILL.md` | Skill | P1 - High | ~444 | Add feedback to output phase |
| `skills/architect-detective/SKILL.md` | Skill | P1 - High | ~428 | Add feedback to output phase |
| `skills/tester-detective/SKILL.md` | Skill | P1 - High | ~490 | Add feedback to output phase |
| `skills/debugger-detective/SKILL.md` | Skill | P1 - High | ~469 | Add feedback to output phase |
| `skills/ultrathink-detective/SKILL.md` | Skill | P0 - Critical | ~787 | Add feedback to all dimensions |
| `skills/claudemem-orchestration/SKILL.md` | Skill | P1 - High | ~219 | Add multi-agent feedback consolidation |
| `skills/deep-analysis/SKILL.md` | Skill | P2 - Medium | TBD | Add feedback if uses claudemem |
| `skills/code-search-selector/SKILL.md` | Skill | P3 - Low | TBD | Add feedback routing |
| `skills/search-interceptor/SKILL.md` | Skill | P3 - Low | TBD | Add feedback interception |

### Impact Summary

- **11 files** to modify
- **~4,700 lines** of existing content
- **~300-400 lines** of new content to add
- **Est. implementation time:** 2-3 hours

---

## Core Pattern Design

### The Feedback Tracking Pattern

All claudemem-using components need to implement this pattern:

```
┌─────────────────────────────────────────────────────────────────┐
│                  FEEDBACK TRACKING PATTERN                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PHASE 1: Search with ID capture                                │
│  ─────────────────────────────────────────────────              │
│  RESULTS=$(claudemem --agent search "query" -n 10)       │
│  # Parse result IDs from output                                  │
│  ALL_RESULT_IDS=$(echo "$RESULTS" | grep "^id:" | cut -d: -f2)  │
│  ORIGINAL_QUERY="query"                                          │
│                                                                  │
│  PHASE 2: Use results during investigation                       │
│  ─────────────────────────────────────────────────              │
│  # Track which IDs are actually read and useful                  │
│  HELPFUL_IDS=()                                                  │
│  UNHELPFUL_IDS=()                                                │
│                                                                  │
│  # When reading a result:                                        │
│  if [result was useful]; then                                    │
│    HELPFUL_IDS+=("$result_id")                                   │
│  else                                                            │
│    UNHELPFUL_IDS+=("$result_id")                                 │
│  fi                                                              │
│                                                                  │
│  PHASE 3: Report feedback at end                                 │
│  ─────────────────────────────────────────────────              │
│  claudemem feedback --query "$ORIGINAL_QUERY" \                  │
│    --helpful "${HELPFUL_IDS[*]}" \                               │
│    --unhelpful "${UNHELPFUL_IDS[*]}"                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### When to Track as Helpful

A result should be marked as **helpful** when:
- The file was read and contained relevant information
- The code was used to understand the problem
- The symbol was part of the call chain being traced
- The file contributed to the final answer

### When to Track as Unhelpful

A result should be marked as **unhelpful** when:
- The file was read but contained irrelevant information
- The result was a false positive (matched query but wrong context)
- The file was skipped after reading initial content
- The symbol was not related to the investigation

### When NOT to Track

Do not track feedback for:
- Results from `map` command (structural overview, not semantic search)
- Results from `symbol` command (exact lookup, not search)
- Results from `callers`/`callees` commands (call graph, not search)
- Only `search` command results should have feedback

---

## Skill-Specific Changes

### claudemem-search/SKILL.md (Primary Reference)

This is the main reference skill. Add a new section after "Installation & Setup":

```markdown
---

## Search Feedback Protocol (v0.8.0+)

Claudemem learns from your search patterns. After completing a task, report which search results were helpful to improve future searches.

### Why Feedback Matters

| Feedback Type | Effect | Over Time |
|---------------|--------|-----------|
| Helpful | +10% boost | Files you consistently use rank higher |
| Unhelpful | -10% demotion | Irrelevant results rank lower |
| Document Type | Type weighting | Helpful types (e.g., symbol_summary) get priority |

### CLI Interface

```bash
# After using search results, report feedback
claudemem feedback --query "your original query" \
  --helpful id1,id2 \
  --unhelpful id3,id4

# Result IDs are shown in search output:
claudemem --agent search "authentication"  # Output includes:
# id: abc123
# file: src/auth/middleware.ts
# ...
```

### MCP Interface

```json
{
  "tool": "report_search_feedback",
  "arguments": {
    "query": "authentication flow",
    "allResultIds": ["id1", "id2", "id3"],
    "helpfulIds": ["id1"],
    "unhelpfulIds": ["id3"]
  }
}
```

### Integration with Workflow Templates

Add feedback reporting to the end of each workflow template:

```bash
# Template 1: Bug Investigation (add at end)
# Step 7: Report feedback
if [ -n "$ORIGINAL_QUERY" ] && [ -n "$HELPFUL_IDS" ]; then
  claudemem feedback --query "$ORIGINAL_QUERY" \
    --helpful "${HELPFUL_IDS}" \
    --unhelpful "${UNHELPFUL_IDS}" 2>/dev/null || true
fi
```

### Feedback Workflow Example

```bash
# Full investigation with feedback tracking

# 1. Search and capture IDs
RESULTS=$(claudemem --agent search "payment processing" -n 10)
ALL_IDS=$(echo "$RESULTS" | grep "^id:" | cut -d' ' -f2)
ORIGINAL_QUERY="payment processing"

# 2. Initialize tracking arrays
HELPFUL=()
UNHELPFUL=()

# 3. Process results (during investigation)
# When you read a result and it's useful:
HELPFUL+=("abc123")
# When you read a result and it's not relevant:
UNHELPFUL+=("def456")

# 4. Report feedback (at end of investigation)
if [ ${#HELPFUL[@]} -gt 0 ] || [ ${#UNHELPFUL[@]} -gt 0 ]; then
  claudemem feedback \
    --query "$ORIGINAL_QUERY" \
    --helpful "$(IFS=,; echo "${HELPFUL[*]}")" \
    --unhelpful "$(IFS=,; echo "${UNHELPFUL[*]}")" \
    2>/dev/null || echo "Note: Feedback not sent (optional)"
fi
```

### Quality Checklist Update

Add to the existing Quality Checklist:

- [ ] **Tracked result IDs during search** (if using `search` command)
- [ ] **Reported feedback at end of investigation** (if applicable)
```

### detective skill templates (architect, developer, tester, debugger)

Add a new phase to each detective skill workflow. Insert after the final investigation phase:

```markdown
---

## Phase 6: Feedback Reporting (Optional but Recommended)

After completing the investigation, report search feedback to improve future results.

### When to Report Feedback

Report feedback when you used the `search` command during investigation:

```bash
# If you performed searches during investigation:
if [ -n "$SEARCH_QUERIES" ]; then
  # Report for each search query
  for query in "${SEARCH_QUERIES[@]}"; do
    claudemem feedback \
      --query "$query" \
      --helpful "${HELPFUL_FOR_QUERY[$query]}" \
      --unhelpful "${UNHELPFUL_FOR_QUERY[$query]}" \
      2>/dev/null || true
  done
fi
```

### What to Report

| Result Type | Mark As | Reason |
|-------------|---------|--------|
| Read and used | Helpful | Contributed to investigation |
| Read but irrelevant | Unhelpful | False positive |
| Skipped after preview | Unhelpful | Not relevant to query |
| Never read | (Don't track) | Can't evaluate |

### Output Format Update

Add to the investigation report:

```
┌─────────────────────────────────────────────────────────────────┐
│                    INVESTIGATION COMPLETE                        │
├─────────────────────────────────────────────────────────────────┤
│  [Standard investigation results...]                            │
│                                                                  │
│  📊 Search Feedback Reported:                                   │
│  └── Query: "authentication flow"                               │
│      └── Helpful: 3 results                                     │
│      └── Unhelpful: 2 results                                   │
│      └── Status: ✓ Submitted                                    │
└─────────────────────────────────────────────────────────────────┘
```
```

### ultrathink-detective/SKILL.md

The ultrathink skill uses ALL claudemem commands across multiple dimensions. Add feedback tracking for each dimension that uses `search`:

```markdown
---

## Feedback Integration (v0.8.0+)

Ultrathink performs multi-dimensional analysis. Track feedback for dimensions that use the `search` command.

### Dimension-Specific Feedback

| Dimension | Uses Search? | Track Feedback? |
|-----------|--------------|-----------------|
| Architecture (map) | No | Skip |
| Implementation (callers/callees) | No | Skip |
| Test Coverage (callers) | No | Skip |
| Reliability (context) | No | Skip |
| Security (symbol + callers) | No | Skip |
| Performance (search) | **Yes** | **Track** |
| Code Health (dead-code, test-gaps) | No | Skip |

### Performance Dimension Feedback

```bash
# Dimension 6: Performance (semantic search)
PERF_RESULTS=$(claudemem --agent search "query database batch")
PERF_IDS=$(echo "$PERF_RESULTS" | grep "^id:" | cut -d' ' -f2)
PERF_QUERY="query database batch"

# Track during analysis
PERF_HELPFUL=()
PERF_UNHELPFUL=()

# ... use results ...

# Report at end
claudemem feedback \
  --query "$PERF_QUERY" \
  --helpful "${PERF_HELPFUL[*]}" \
  --unhelpful "${PERF_UNHELPFUL[*]}" 2>/dev/null || true
```

### Comprehensive Report Update

Add to the output format:

```
┌─────────────────────────────────────────────────────────────────┐
│           CODEBASE COMPREHENSIVE ANALYSIS (v0.3.0)               │
├─────────────────────────────────────────────────────────────────┤
│  [Existing summary...]                                          │
│                                                                  │
│  Search Feedback:                                                │
│  └── Performance queries: 2 submitted                           │
│  └── Helpful results: 5                                         │
│  └── Unhelpful results: 3                                       │
└─────────────────────────────────────────────────────────────────┘
```
```

---

## Agent-Specific Changes

### codebase-detective.md

Add a feedback phase to the agent workflow:

```markdown
---

## Phase 6: Feedback Reporting

After completing the investigation, report search feedback.

### Feedback Protocol

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                         FEEDBACK REPORTING PHASE                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║                                                                              ║
║  After investigation completes:                                              ║
║                                                                              ║
║  1. Collect all search queries used during investigation                     ║
║  2. For each query, identify helpful vs unhelpful results                    ║
║  3. Report feedback to claudemem                                             ║
║                                                                              ║
║  claudemem feedback --query "original query" \                               ║
║    --helpful id1,id2 --unhelpful id3,id4                                    ║
║                                                                              ║
║  Note: This is optional but improves future search accuracy                  ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

### Implementation

At the end of every investigation:

```bash
# If search command was used during investigation
if [ -n "$SEARCH_PERFORMED" ]; then
  # Report feedback for improved future searches
  report_search_feedback() {
    local query="$1"
    local helpful="$2"
    local unhelpful="$3"

    # Use CLI
    claudemem feedback \
      --query "$query" \
      --helpful "$helpful" \
      --unhelpful "$unhelpful" 2>/dev/null || true
  }

  # Report for all queries
  for query_data in "${SEARCH_QUERIES[@]}"; do
    report_search_feedback "${query_data[query]}" \
      "${query_data[helpful]}" "${query_data[unhelpful]}"
  done
fi
```

### Final Reminder Update

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║   EVERY INVESTIGATION:                                                       ║
║                                                                              ║
║   1. which claudemem                                                         ║
║   2. claudemem --agent map "task"   ← STRUCTURE FIRST                ║
║   3. claudemem --agent symbol <name>                                 ║
║   4. claudemem --agent callers <name> ← BEFORE MODIFYING             ║
║   5. Read specific file:line (NOT whole files)                              ║
║   6. claudemem feedback ... ← REPORT HELPFUL/UNHELPFUL (if search used)    ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
```
```

---

## Orchestration Changes

### claudemem-orchestration/SKILL.md

Add feedback consolidation for multi-agent scenarios:

```markdown
---

## Pattern 4: Consolidated Feedback Reporting

When multiple agents perform searches, consolidate feedback for efficiency.

### Shared Feedback File

```bash
# Each agent writes feedback to shared file in session directory
echo "query:$QUERY|helpful:$HELPFUL|unhelpful:$UNHELPFUL" >> "$SESSION_DIR/feedback.log"

# Consolidation agent reads and reports all feedback
while IFS='|' read -r query helpful unhelpful; do
  QUERY_VAL=$(echo "$query" | cut -d: -f2)
  HELPFUL_VAL=$(echo "$helpful" | cut -d: -f2)
  UNHELPFUL_VAL=$(echo "$unhelpful" | cut -d: -f2)

  claudemem feedback \
    --query "$QUERY_VAL" \
    --helpful "$HELPFUL_VAL" \
    --unhelpful "$UNHELPFUL_VAL" 2>/dev/null || true
done < "$SESSION_DIR/feedback.log"
```

### Multi-Agent Feedback Pattern

```
Phase 1: Preparation
  └── Create feedback log: "$SESSION_DIR/feedback.log"

Phase 2: Parallel Execution
  └── Agent 1: Writes feedback to log
  └── Agent 2: Writes feedback to log
  └── Agent 3: Writes feedback to log

Phase 3: Consolidation
  └── Read all feedback entries
  └── Submit to claudemem
  └── Log results

Phase 4: Cleanup
  └── Remove session directory (includes feedback log)
```

### Best Practices Update

Add to existing best practices:

**Do:**
- Collect feedback from all agents that used `search`
- Consolidate feedback in session directory
- Report after consolidation (not during parallel execution)
- Handle feedback failures gracefully (don't block workflow)

**Don't:**
- Report feedback from each agent individually (duplicates)
- Block on feedback submission
- Fail investigation if feedback fails
- Track feedback for non-search commands (map, symbol, etc.)
```

---

## CLI vs MCP Interfaces

### CLI Interface

Use CLI when running claudemem directly via Bash:

```bash
# CLI feedback command
claudemem feedback \
  --query "authentication flow" \
  --helpful "abc123,def456" \
  --unhelpful "ghi789"

# With error handling
if ! claudemem feedback \
  --query "$QUERY" \
  --helpful "$HELPFUL" \
  --unhelpful "$UNHELPFUL" 2>&1; then
  echo "Note: Feedback submission failed (optional feature)"
fi
```

### MCP Interface

Use MCP when claudemem is running as an MCP server:

```json
{
  "tool": "report_search_feedback",
  "arguments": {
    "query": "authentication flow",
    "allResultIds": ["abc123", "def456", "ghi789", "jkl012"],
    "helpfulIds": ["abc123", "def456"],
    "unhelpfulIds": ["ghi789"]
  }
}
```

### Detecting Context

```bash
# Check if claudemem is running as MCP server
if [ -n "$CLAUDEMEM_MCP_MODE" ]; then
  # Use MCP tool call
  use_mcp_feedback "$QUERY" "$HELPFUL" "$UNHELPFUL"
else
  # Use CLI command
  claudemem feedback --query "$QUERY" \
    --helpful "$HELPFUL" --unhelpful "$UNHELPFUL"
fi
```

### Recommendation

For code-analysis plugin skills and agents:
- **Default to CLI** - Most reliable, works in all contexts
- **Use MCP only if** explicitly configured for MCP mode
- **Always handle failures gracefully** - Feedback is enhancement, not critical

---

## Implementation Templates

### Template 1: Simple Skill Feedback

For skills that occasionally use search:

```markdown
## Feedback Reporting

After completing the investigation:

\`\`\`bash
# Report feedback if search was used
if [ -n "$SEARCH_QUERY" ]; then
  claudemem feedback \
    --query "$SEARCH_QUERY" \
    --helpful "$HELPFUL_IDS" \
    --unhelpful "$UNHELPFUL_IDS" 2>/dev/null || true
  echo "Search feedback submitted."
fi
\`\`\`
```

### Template 2: Agent Workflow Feedback

For agents with structured workflows:

```markdown
## Phase N: Feedback Reporting (Final Phase)

\`\`\`bash
# Collect all search queries used during investigation
declare -A SEARCH_FEEDBACK

# During investigation, track results:
# SEARCH_FEEDBACK["query"]="helpful:id1,id2|unhelpful:id3"

# At end of investigation:
for query in "${!SEARCH_FEEDBACK[@]}"; do
  IFS='|' read -r helpful_part unhelpful_part <<< "${SEARCH_FEEDBACK[$query]}"
  HELPFUL=$(echo "$helpful_part" | cut -d: -f2)
  UNHELPFUL=$(echo "$unhelpful_part" | cut -d: -f2)

  claudemem feedback \
    --query "$query" \
    --helpful "$HELPFUL" \
    --unhelpful "$UNHELPFUL" 2>/dev/null || true
done
\`\`\`

### Output Update

Include in final output:

\`\`\`
Search Feedback: X queries submitted (Y helpful, Z unhelpful results)
\`\`\`
```

### Template 3: Orchestration Feedback

For multi-agent orchestration:

```markdown
## Feedback Consolidation

\`\`\`bash
# Initialize feedback collection
FEEDBACK_LOG="$SESSION_DIR/search-feedback.jsonl"
touch "$FEEDBACK_LOG"

# During parallel execution, agents append to log:
# echo '{"query":"...","helpful":["..."],"unhelpful":["..."]}' >> "$FEEDBACK_LOG"

# After consolidation:
while IFS= read -r line; do
  QUERY=$(echo "$line" | jq -r '.query')
  HELPFUL=$(echo "$line" | jq -r '.helpful | join(",")')
  UNHELPFUL=$(echo "$line" | jq -r '.unhelpful | join(",")')

  claudemem feedback \
    --query "$QUERY" \
    --helpful "$HELPFUL" \
    --unhelpful "$UNHELPFUL" 2>/dev/null || true
done < "$FEEDBACK_LOG"

# Cleanup
rm -f "$FEEDBACK_LOG"
\`\`\`
```

---

## Impact Assessment

### Positive Impacts

1. **Improved Search Accuracy** - Over time, search results become more relevant
2. **Faster Investigations** - Less time spent on irrelevant results
3. **Per-Project Learning** - Each project develops its own search profile
4. **Document Type Optimization** - Helpful document types get prioritized

### Potential Concerns

1. **Additional Complexity** - Agents need to track result IDs
2. **State Management** - Need to maintain helpful/unhelpful arrays during investigation
3. **Failure Handling** - Feedback failures should not block workflows
4. **Performance Overhead** - Minimal (one HTTP call at end of investigation)

### Mitigation Strategies

1. **Keep it Simple** - Basic tracking with optional reporting
2. **Graceful Degradation** - All feedback calls wrapped in `|| true`
3. **Clear Documentation** - Explicit when to track and what to report
4. **Minimal Overhead** - Report once at end, not during investigation

---

## Testing Strategy

### Unit Testing

For each modified file, verify:

1. Feedback section is properly formatted
2. Code examples are syntactically correct
3. Templates integrate with existing workflow phases
4. Error handling is present (`|| true` or equivalent)

### Integration Testing

1. Run a sample investigation with feedback tracking enabled
2. Verify feedback is submitted to claudemem
3. Verify subsequent searches show improved ranking
4. Verify failure does not block investigation

### Manual Testing Checklist

- [ ] claudemem-search skill: Feedback section added
- [ ] codebase-detective agent: Phase 6 feedback added
- [ ] All detective skills: Output phase feedback added
- [ ] ultrathink-detective: Performance dimension feedback added
- [ ] claudemem-orchestration: Pattern 4 consolidation added
- [ ] Search feedback actually improves results over time

---

## Implementation Order

### Phase 1: Core Infrastructure (P0)

1. **claudemem-search/SKILL.md** - Add comprehensive feedback documentation
2. **agents/codebase-detective.md** - Add feedback phase to workflow

### Phase 2: Detective Skills (P1)

3. **developer-detective/SKILL.md** - Add feedback to output phase
4. **architect-detective/SKILL.md** - Add feedback to output phase
5. **tester-detective/SKILL.md** - Add feedback to output phase
6. **debugger-detective/SKILL.md** - Add feedback to output phase

### Phase 3: Advanced Integration (P1)

7. **ultrathink-detective/SKILL.md** - Add feedback to performance dimension
8. **claudemem-orchestration/SKILL.md** - Add multi-agent feedback consolidation

### Phase 4: Supporting Files (P2-P3)

9. **deep-analysis/SKILL.md** - Add if uses search
10. **code-search-selector/SKILL.md** - Add feedback routing
11. **search-interceptor/SKILL.md** - Add feedback interception

---

## Version Compatibility

### Claudemem Version Requirements

- **v0.7.0+** - Current version in SKILL.md
- **v0.8.0+** - Feedback protocol (assumed)

### Graceful Degradation

```bash
# Check if feedback is supported
if claudemem feedback --help 2>&1 | grep -q "report search feedback"; then
  # Feedback supported
  claudemem feedback --query "$QUERY" --helpful "$HELPFUL" --unhelpful "$UNHELPFUL"
else
  # Feedback not supported (older version)
  echo "Note: Search feedback requires claudemem v0.8.0+"
fi
```

---

## Summary

This design adds claudemem search feedback protocol to the code-analysis plugin with:

- **11 files** modified across skills, agents, and orchestration
- **Consistent pattern** for tracking helpful/unhelpful results
- **Non-blocking implementation** with graceful error handling
- **CLI and MCP interfaces** documented
- **Clear templates** for each file type

The implementation enables per-project learning where search results improve over time based on actual usage patterns.

---

**Design Document Created By:** Claude Agent Designer
**Plugin:** code-analysis v2.8.0 (target)
**Date:** December 2025
