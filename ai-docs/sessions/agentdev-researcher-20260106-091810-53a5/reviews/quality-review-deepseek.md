# Quality Review: /dev:research Command Implementation

**Status**: CONDITIONAL
**Reviewer**: DeepSeek Chat v3
**Review Date**: January 6, 2026
**Files Reviewed**:
- `/Users/jack/mag/claude-code/plugins/dev/commands/research.md`
- `/Users/jack/mag/claude-code/plugins/dev/agents/researcher.md`
- `/Users/jack/mag/claude-code/plugins/dev/agents/synthesizer.md`
- `/Users/jack/mag/claude-code/plugins/dev/plugin.json`

---

## Executive Summary

The `/dev:research` command is a sophisticated 6-phase deep research orchestrator with strong architectural foundations. Implementation demonstrates excellent understanding of parallel execution patterns, convergence detection, and file-based communication. However, several design concerns require resolution before production deployment.

**Overall Score**: 7.8/10
**Primary Concerns**: 3 CRITICAL, 3 HIGH, 5 MEDIUM
**Recommendation**: Fix CRITICAL issues and HIGH priority items before release

---

## CRITICAL Issues

### CRITICAL 1: Model Strategy Fallback Missing OpenRouter Error Handling

**Location**: research.md lines 93-130, 664-680
**Category**: Error Recovery / Model Handling
**Severity**: CRITICAL

**Issue**:
The model fallback strategy detects OpenRouter but provides no error handling when claudish is unavailable or OpenRouter API fails. Phase 0 would detect the strategy but provide no recovery path if actual delegation fails.

```yaml
# Current (lines 186-189):
elif command -v claudish &> /dev/null && [[ -n "$OPENROUTER_API_KEY" ]]; then
  echo "MODEL_STRATEGY=openrouter" > "${SESSION_PATH}/config.env"
  echo "PROXY_MODEL=or/google/gemini-3-pro-preview" >> "${SESSION_PATH}/config.env"
  # NO ERROR HANDLING IF CLAUDISH CALL FAILS LATER
```

**Why it Matters**:
- User sees "OpenRouter available" but research fails mid-execution
- No graceful fallback to Haiku
- Orchestrator cannot recover from API failures
- Session left in inconsistent state

**Fix Required**:
1. Add wrapper function for claudish calls with error checking
2. Implement fallback detection during Phase 3 (Web Exploration)
3. Graceful degradation to native strategy on failure
4. Detailed error logging for debugging

**Suggested Implementation**:
```bash
# In Phase 3, before delegating to researcher:
validate_model_strategy() {
  local strategy=$(grep "MODEL_STRATEGY" "${SESSION_PATH}/config.env" | cut -d= -f2)

  if [[ "$strategy" == "openrouter" ]]; then
    # Test claudish availability
    if ! command -v claudish &> /dev/null; then
      echo "ERROR: OpenRouter strategy selected but claudish not found"
      switch_to_native_strategy
      return 1
    fi
    # Test OPENROUTER_API_KEY
    if [[ -z "$OPENROUTER_API_KEY" ]]; then
      echo "ERROR: OpenRouter strategy selected but OPENROUTER_API_KEY not set"
      switch_to_native_strategy
      return 1
    fi
  fi
  return 0
}

switch_to_native_strategy() {
  echo "MODEL_STRATEGY=native" > "${SESSION_PATH}/config.env"
  echo "AGENT_MODEL=haiku" >> "${SESSION_PATH}/config.env"
  echo "NOTE: Degraded to native strategy (OpenRouter unavailable)" >> "${SESSION_PATH}/errors.log"
}
```

---

### CRITICAL 2: Convergence Check k=3 Window Not Enforced

**Location**: research.md lines 409-481 (PHASE 5), lines 618-661 (convergence_algorithm)
**Category**: Convergence Detection
**Severity**: CRITICAL

**Issue**:
Phase 5 (Convergence Check) describes the k=3 consecutive stable syntheses algorithm but provides no EXPLICIT IMPLEMENTATION of how consecutive matches are tracked and validated. The orchestrator has no mechanism to:

1. Store synthesis signatures from previous iterations
2. Verify 3 consecutive iterations meet 80%+ overlap threshold
3. Reset consecutive match counter if overlap drops below threshold

**Current Text** (lines 414-420):
```
**Criterion 1: Answer Convergence (k=3)**
- Compare current synthesis with previous iterations
- Extract key findings from each
- If same 80%+ of key findings for 3 consecutive attempts: CONVERGED
- Calculation: intersection(findings_N, findings_N-1, findings_N-2) / union >= 0.8
```

**The Problem**:
This is PSEUDOCODE, not an IMPLEMENTATION. The command provides no:
- Bash/Python code to calculate intersection/union
- Logic to track "consecutive" matches (what if iteration 2 → 3 converges but 3 → 4 diverges?)
- Storage mechanism for synthesis signatures
- Decision logic when convergence detection fails

**Why it Matters**:
- Core research completion logic is undefined
- Research could loop forever or stop prematurely
- No clear path for users to know if research converged
- Violates DRY principle (code duplicated in knowledge/orchestration sections)

**Fix Required**:
Implement explicit convergence checking in Phase 5:

```bash
# Phase 5 Implementation (missing from current command)
calculate_convergence_score() {
  local iteration="$1"
  local session_path="$2"

  if [[ $iteration -lt 3 ]]; then
    return 1  # Not enough iterations
  fi

  # Extract key findings from current synthesis
  local current_file="${session_path}/synthesis/iteration-${iteration}.md"
  local current_findings=$(extract_key_findings "$current_file" | sort)

  # Extract from iteration N-1
  local prev1_findings=$(extract_key_findings "${session_path}/synthesis/iteration-$((iteration-1)).md" | sort)

  # Extract from iteration N-2
  local prev2_findings=$(extract_key_findings "${session_path}/synthesis/iteration-$((iteration-2)).md" | sort)

  # Calculate intersection and union
  local intersection=$(comm -12 <(echo "$current_findings") <(echo "$prev1_findings") | wc -l)
  local intersection=$(comm -12 <(echo "$intersection") <(echo "$prev2_findings") | wc -l)

  local union=$(cat <(echo "$current_findings") <(echo "$prev1_findings") <(echo "$prev2_findings") | sort -u | wc -l)

  # Calculate similarity
  if [[ $union -eq 0 ]]; then
    echo "0"
    return
  fi

  local similarity=$(echo "scale=2; $intersection * 100 / $union" | bc)
  echo "$similarity"
}

# Check convergence in Phase 5
CURRENT_ITERATION=$(grep "exploration_iteration" "${SESSION_PATH}/session-meta.json" | grep -o '[0-9]*')

if [[ $CURRENT_ITERATION -ge 3 ]]; then
  SIMILARITY=$(calculate_convergence_score $CURRENT_ITERATION "$SESSION_PATH")

  if (( $(echo "$SIMILARITY >= 80" | bc -l) )); then
    # CONVERGED: Update session metadata
    jq --arg iteration "$CURRENT_ITERATION" \
       --argjson similarity "$SIMILARITY" \
       '.convergence.achieved = true |
        .convergence.consecutiveMatches = 3 |
        .convergence.similarity = $similarity |
        .convergence.criterion = "answer_convergence"' \
       "${SESSION_PATH}/session-meta.json" > "${SESSION_PATH}/session-meta.json.tmp"
    mv "${SESSION_PATH}/session-meta.json.tmp" "${SESSION_PATH}/session-meta.json"

    # Proceed to PHASE 6
  else
    # NOT CONVERGED: Continue exploration or ask user
    echo "Similarity: ${SIMILARITY}% (need 80%+)"
  fi
fi
```

---

### CRITICAL 3: Agent Registration Inconsistency

**Location**: plugin.json lines 48-50, agents/ directory
**Category**: Configuration
**Severity**: CRITICAL

**Issue**:
The plugin.json registers "researcher" and "synthesizer" agents (lines 48-50), but the FRONTMATTER contains no `name:` field matching agent files:

```json
// plugin.json (line 49-50)
"./agents/researcher.md",
"./agents/synthesizer.md"
```

**But in researcher.md**:
```yaml
---
name: researcher  # ← MATCHES
```

**However, Command frontmatter line 6** references them as agents in delegation:
```
skills: dev:context-detection, orchestration:multi-model-validation
```

The command ITSELF is registered but orchestrator delegating to `Task: researcher` may fail if:
- Agent path resolution uses frontmatter `name` field
- Agent lookup fails if name mismatch between plugin.json and .md file

**Why it Matters**:
- Task tool may not find agents
- Parallel execution in Phase 3 fails silently
- Users get confusing "agent not found" errors
- Plugin registration is inconsistent

**Fix Required**:
1. Verify agent names match exactly between plugin.json and YAML frontmatter
2. Add agent names to allowed-tools in orchestration section:
   ```yaml
   allowed-tools: Task (researcher, synthesizer agents), AskUserQuestion, Bash, Read, TodoWrite, Glob, Grep
   ```
3. Add validation in Phase 0:
   ```bash
   # Verify agents are accessible
   if ! claude-plugin-lookup researcher >/dev/null 2>&1; then
     echo "ERROR: researcher agent not registered"
     exit 1
   fi
   ```

---

## HIGH Priority Issues

### HIGH 1: Parallel Execution Pattern Missing Task Delimiter Documentation

**Location**: research.md lines 301-330 (parallel_execution_pattern)
**Category**: Documentation / Pattern Clarity
**Severity**: HIGH

**Issue**:
The parallel execution pattern shows pseudo-Task syntax but doesn't clarify:
1. Task calls must be EXACTLY separated by `---` on own line
2. Each Task must have UNIQUE output file path
3. No dependencies between Tasks (they execute simultaneously)

Current text (lines 301-330) shows example but lacks CRITICAL detail that single message uses:
```
Task: researcher
  Prompt: "..."
---
Task: researcher
  Prompt: "..."
```

But doesn't explain:
- The `---` is CRITICAL for parallel execution
- Message structure must be exactly this format
- Missing `---` makes Tasks execute sequentially (defeats purpose)

**Why it Matters**:
- Orchestrator may implement with sequential Tasks
- Performance degrades from O(n) parallel to O(n) sequential
- Users don't understand why "parallel research" takes 10 minutes instead of 3

**Fix Required**:
Enhance parallel_execution_pattern section:
```xml
<parallel_execution_pattern>
  **Single message with multiple Task calls executes in parallel:**

  ## CRITICAL: Task Delimiter Format

  Task calls MUST be separated by exactly: --- (on own line)

  ✅ CORRECT (Parallel):
  ```
  Task: researcher
    Prompt: "Sub-question 1..."
  ---
  Task: researcher
    Prompt: "Sub-question 2..."
  ---
  Task: researcher
    Prompt: "Sub-question 3..."
  ```

  All 3 execute SIMULTANEOUSLY (3x parallelism!)

  ❌ WRONG (Sequential):
  ```
  Task: researcher
    Prompt: "Sub-question 1..."

  Task: researcher
    Prompt: "Sub-question 2..."

  Task: researcher
    Prompt: "Sub-question 3..."
  ```

  Each Task waits for previous (3x slower, defeats purpose)

  ## Output File Isolation

  Each Task MUST write to UNIQUE file within session:

  ✅ CORRECT:
  - Task 1 → ${SESSION_PATH}/findings/explorer-1.md
  - Task 2 → ${SESSION_PATH}/findings/explorer-2.md
  - Task 3 → ${SESSION_PATH}/findings/explorer-3.md

  ❌ WRONG (Overwrites):
  - Task 1 → ${SESSION_PATH}/findings/findings.md
  - Task 2 → ${SESSION_PATH}/findings/findings.md
  - Task 3 → ${SESSION_PATH}/findings/findings.md

  ## Independence Requirement

  Each Task must have NO DEPENDENCIES:

  ✅ CORRECT (Independent):
  - Task 1: Research sub-question A
  - Task 2: Research sub-question B
  - Task 3: Research sub-question C

  ❌ WRONG (Dependent):
  - Task 1: Implement feature X
  - Task 2: Write tests for feature X (needs X to exist)
  - Task 3: Review feature X (needs tests to run)
</parallel_execution_pattern>
```

---

### HIGH 2: Quality Gate Thresholds Not Enforced in Phase 5

**Location**: research.md lines 433-436 (Criterion 4)
**Category**: Quality Assurance
**Severity**: HIGH

**Issue**:
Phase 5 specifies quality gates:
```
**Criterion 4: Quality Gate (NEW)**
- Factual Integrity: 90%+ claims must be sourced
- Agreement Score: 60%+ findings must have multi-source support
- If quality metrics below threshold: Continue exploration
```

But provides NO IMPLEMENTATION of:
1. How to extract quality metrics from synthesizer output
2. What happens if metrics below threshold
3. How synthesizer communicates metrics to orchestrator
4. Whether to loop back to Phase 3 automatically or ask user

**Current State**:
- Synthesizer generates metrics (good)
- Orchestrator never reads or validates them
- Research proceeds regardless of quality
- Users could get 10% factual integrity report marked "COMPLETE"

**Why it Matters**:
- Core quality validation is missing
- Research legitimacy not verified
- Users unaware their research is low quality
- Violates research integrity principles

**Fix Required**:
1. Synthesizer returns metrics in structured format:
   ```bash
   # In synthesizer agent return summary
   "Synthesis: 5 findings, Factual Integrity 95%, Agreement Score 72%, Quality PASS"
   ```

2. Orchestrator validates metrics before Phase 6:
   ```bash
   # Phase 5 Quality Gate Check
   FACTUAL_INTEGRITY=$(echo "$SYNTHESIZER_OUTPUT" | grep -oP 'Factual Integrity \K[0-9.]+')
   AGREEMENT_SCORE=$(echo "$SYNTHESIZER_OUTPUT" | grep -oP 'Agreement Score \K[0-9.]+')

   if (( $(echo "$FACTUAL_INTEGRITY < 90" | bc -l) )); then
     echo "QUALITY GATE FAILED: Factual Integrity ${FACTUAL_INTEGRITY}% (need 90%+)"

     if [[ $CURRENT_ITERATION -lt 5 ]]; then
       echo "Continuing exploration to improve quality..."
       # Return to PHASE 3
     else
       echo "Max iterations reached. Proceeding with current quality."
     fi
   fi
   ```

---

### HIGH 3: Session Metadata Structure Undefined

**Location**: research.md lines 199-219 (Session metadata example), 538-561 (Final session metadata)
**Category**: Architecture / File Structure
**Severity**: HIGH

**Issue**:
Phase 0 provides example JSON structure for session metadata (lines 199-219), but:
1. File path not specified (session-meta.json? metadata.json?)
2. Structure differs between Phase 0 (lines 199-219) and Phase 6 (lines 538-561)
3. No validation that file is created or persisted correctly
4. Phase 5 convergence check references session metadata but path undefined

**Phase 0 example** (lines 199-219):
```json
{
  "sessionId": "{SESSION_ID}",
  "createdAt": "{timestamp}",
  "topic": "{research_topic}",
  "status": "in_progress",
  "modelStrategy": "{strategy}",
  "iterations": {...},
  "convergence": {...}
}
```

**Phase 6 example** (lines 538-561):
```json
{
  "status": "completed",
  "completedAt": "{timestamp}",
  "iterations": {...},
  "convergence": {...},
  "sources": {...},  // ← NEW field not in Phase 0
  "qualityMetrics": {...}  // ← NEW field not in Phase 0
}
```

**Problems**:
- Unclear if file path is `${SESSION_PATH}/session-meta.json` or something else
- Unclear how to MERGE Phase 0 and Phase 6 structures (create new or update?)
- Unclear how Phase 5 reads convergence state (file path undefined)
- Unclear if file is JSON, YAML, or shell variables

**Why it Matters**:
- Orchestrator cannot persist state
- Cannot resume from interrupted research
- Cannot validate convergence (would need to parse inconsistent structure)
- Makes session isolation fragile

**Fix Required**:
1. Define SINGLE metadata file structure that grows over time:
   ```json
   {
     "sessionId": "dev-research-topic-20260106-120000-a3f2",
     "createdAt": "2026-01-06T12:00:00Z",
     "topic": "Research topic",
     "status": "in_progress|completed|failed",
     "modelStrategy": "gemini-direct|openrouter|native",

     // Updated in Phase 0 and never changed
     "initialized": true,

     // Updated after each exploration round
     "iterations": {
       "exploration": 2,
       "synthesis": 2,
       "maxExploration": 5,
       "maxSynthesis": 3
     },

     // Updated after Phase 5 convergence check
     "convergence": {
       "achieved": false,
       "consecutiveMatches": 0,
       "targetMatches": 3,
       "lastCheck": "2026-01-06T12:05:00Z",
       "criterion": null,
       "similarity": null
     },

     // Updated in Phase 4 (synthesis)
     "lastSynthesis": {
       "iteration": 1,
       "timestamp": "2026-01-06T12:04:00Z",
       "findings": 5,
       "factualIntegrity": 92,
       "agreementScore": 68
     },

     // Updated in Phase 6 (finalization)
     "completed": {
       "completedAt": "2026-01-06T12:10:00Z",
       "totalIterations": 2,
       "totalSources": 12,
       "qualityMetrics": {...}
     }
   }
   ```

2. File path: `${SESSION_PATH}/session-meta.json`

3. Operations:
   - Phase 0: CREATE
   - Phase 3: UPDATE iterations.exploration
   - Phase 4: UPDATE lastSynthesis
   - Phase 5: UPDATE convergence
   - Phase 6: UPDATE completed

---

## MEDIUM Priority Issues

### MEDIUM 1: Topic Slug Generation May Produce Invalid Filenames

**Location**: research.md lines 172 (PHASE 0, session ID generation)
**Category**: File System Handling
**Severity**: MEDIUM

**Issue**:
Session ID generation (line 172-173):
```bash
TOPIC_SLUG=$(echo "${TOPIC:-research}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9-]//g' | head -c30)
SESSION_ID="dev-research-${TOPIC_SLUG}-$(date +%Y%m%d-%H%M%S)-$(head -c4 /dev/urandom | xxd -p)"
```

Edge cases:
1. All non-alphanumeric characters removed → empty slug
   - Input: "C++, Rust & Go??!!"
   - Output: "c--rust-go" (multiple dashes)
   - Result: "dev-research-c--rust-go-..." (looks ugly)

2. Leading/trailing dashes after sed:
   - Input: "...React..."
   - After sed: "-react-" (dashes at edges)
   - Result: "dev-research--react--..." (double dashes)

3. Slug shorter than expected:
   - Input: "!!!" (all special chars)
   - Output: "" (empty)
   - Result: "dev-research--20260106..." (two dashes in a row)

**Why it Matters**:
- Session directory names are ugly and confusing
- Could cause issues with systems expecting valid slugs
- Makes session history hard to read

**Fix Required**:
```bash
# Improved slug generation
generate_topic_slug() {
  local topic="$1"
  local slug

  # Convert to lowercase, replace spaces with dashes
  slug=$(echo "$topic" | tr '[:upper:] ' '[:lower:]-')

  # Remove non-alphanumeric characters (except dashes)
  slug=$(echo "$slug" | sed 's/[^a-z0-9-]//g')

  # Remove leading/trailing dashes
  slug=$(echo "$slug" | sed 's/^-*//; s/-*$//')

  # Replace multiple consecutive dashes with single dash
  slug=$(echo "$slug" | sed 's/-\{2,\}/-/g')

  # Handle empty slug
  if [[ -z "$slug" ]]; then
    slug="research"
  fi

  # Limit to 30 chars
  echo "${slug:0:30}"
}

# Usage:
TOPIC_SLUG=$(generate_topic_slug "$TOPIC")
```

---

### MEDIUM 2: No Timeout Handling for Researcher/Synthesizer Agents

**Location**: research.md Phase 3 (lines 301-350), Phase 4 (lines 354-407)
**Category**: Error Handling
**Severity**: MEDIUM

**Issue**:
Phase 3 launches researcher agents without timeout specification:
```
Task: researcher
  Prompt: "..."
```

If a researcher agent hangs (web API timeout, infinite loop), orchestrator:
1. Waits indefinitely for response
2. Cannot timeout and proceed with other agents
3. Research workflow frozen

No mechanism to:
- Set per-task timeout
- Kill hung agents
- Retry with timeout
- Fall back to partial results

**Why it Matters**:
- Research could hang forever
- Users have no way to cancel
- Wastes time/resources
- Degrades user experience

**Fix Required**:
1. Add timeout enforcement to Phase 3:
   ```bash
   # Phase 3: Web Exploration with Timeout

   RESEARCHER_TIMEOUT=120  # 2 minutes per researcher

   for sub_q in "${SUB_QUESTIONS[@]}"; do
     # Launch task with timeout wrapper
     timeout_task() {
       timeout $RESEARCHER_TIMEOUT Task researcher \
         Prompt: "SESSION_PATH: ${SESSION_PATH}
                  Sub-question: $sub_q
                  ..."
       return $?
     }

     if ! timeout_task; then
       if [[ $? -eq 124 ]]; then
         echo "ERROR: Researcher timeout for sub-question: $sub_q"
         echo "Skipping and continuing with other researchers..."
       fi
     fi
   done
   ```

2. Synthesizer timeout (Phase 4):
   ```bash
   timeout 60 Task synthesizer \
     Prompt: "SESSION_PATH: ${SESSION_PATH}
              ITERATION: $CURRENT_ITERATION
              ..."
   ```

---

### MEDIUM 3: Error Recovery Strategy Incomplete

**Location**: research.md lines 861-913 (error_recovery)
**Category**: Error Handling
**Severity**: MEDIUM

**Issue**:
Error recovery section provides strategies but no EXECUTABLE implementations:

```xml
<strategy scenario="Explorer agent fails">
  <recovery>
    1. Log failure with details to ${SESSION_PATH}/errors.log
    2. If other explorers succeeded (minimum 1): Proceed with available findings
    3. If all failed: Escalate to user
    4. Offer: Retry / Skip sub-question / Cancel research
  </recovery>
</strategy>
```

Problems:
1. "Log failure" - HOW? No code provided
2. "Escalate to user" - HOW? Use AskUserQuestion? Email?
3. "Offer: Retry" - HOW? Would need to restructure Phase 3
4. No handling for PARTIAL failures (2 of 3 researchers succeed)

**Current Implementation Gap**:
- Phase 3 has no error handling code
- If Task fails, orchestrator doesn't catch or handle it
- Research silently fails with confusing message

**Why it Matters**:
- Orchestrator cannot recover from agent failures
- Users get cryptic error messages
- No graceful degradation
- Research workflow is brittle

**Fix Required**:
```bash
# Phase 3: Web Exploration with Error Handling

SUCCESSFUL_EXPLORERS=0
FAILED_EXPLORERS=0
FAILED_QUERIES=()

for i in "${!SUB_QUESTIONS[@]}"; do
  sub_q="${SUB_QUESTIONS[$i]}"
  explorer_file="${SESSION_PATH}/findings/explorer-$((i+1)).md"

  # Launch researcher with error handling
  RESEARCHER_OUTPUT=$(Task researcher Prompt: "..." 2>&1)
  RESEARCHER_EXIT=$?

  if [[ $RESEARCHER_EXIT -eq 0 ]]; then
    ((SUCCESSFUL_EXPLORERS++))
    echo "✓ Explorer $((i+1)) success: $sub_q"
    # Results already in explorer-N.md
  else
    ((FAILED_EXPLORERS++))
    FAILED_QUERIES+=("$sub_q")

    # Log error
    {
      echo "=== EXPLORER $((i+1)) FAILURE ==="
      echo "Timestamp: $(date)"
      echo "Sub-question: $sub_q"
      echo "Exit Code: $RESEARCHER_EXIT"
      echo "Output: $RESEARCHER_OUTPUT"
    } >> "${SESSION_PATH}/errors.log"

    echo "✗ Explorer $((i+1)) failed: $sub_q"
  fi
done

# Check minimum threshold (at least 1 success)
if [[ $SUCCESSFUL_EXPLORERS -eq 0 ]]; then
  echo "ERROR: All researcher agents failed"

  # Ask user for options
  AskUserQuestion {
    question: "All research queries failed. Options?",
    options: [
      {label: "Retry all", value: "retry_all"},
      {label: "Continue with limited findings", value: "continue"},
      {label: "Cancel research", value: "cancel"}
    ]
  }

  RESPONSE=$?  # User choice

  case $RESPONSE in
    retry_all)
      # Return to Phase 3 iteration
      ((EXPLORATION_ITERATION++))
      goto PHASE_3_START
      ;;
    continue)
      # Proceed with empty findings (risky but user accepts)
      break
      ;;
    cancel)
      echo "Research cancelled by user"
      exit 0
      ;;
  esac
elif [[ $FAILED_EXPLORERS -gt 0 ]]; then
  # Partial failure
  echo "WARNING: $FAILED_EXPLORERS researchers failed: ${FAILED_QUERIES[*]}"
  echo "Proceeding with $SUCCESSFUL_EXPLORERS successful results"
  echo "See ${SESSION_PATH}/errors.log for details"

  # Continue to Phase 4 with available findings
fi
```

---

### MEDIUM 4: No Evidence That Agent Tools Match Frontmatter

**Location**: researcher.md lines 10-11, synthesizer.md lines 10-11
**Category**: Consistency
**Severity**: MEDIUM

**Issue**:
Agents declare required tools in frontmatter but description doesn't explain WHAT those tools do or WHY they're needed:

**researcher.md** (lines 10-11):
```yaml
tools: TodoWrite, Read, Write, Bash, Glob, Grep
```

But in workflow:
- TodoWrite: Tracking (standard)
- Read: Read search queries - but WHERE are they?
- Write: Write findings - clarified in Phase 5
- Bash: Web search? Local grep? Both?
- Glob: Find files
- Grep: Search files

**Missing from tools**: No mention of Web Search capability or how it's accessed

**synthesizer.md** (lines 10-11):
```yaml
tools: TodoWrite, Read, Write, Glob, Grep
```

But NO Bash tool while researcher has Bash. Why?
- Researcher needs Bash for web search (reasonable)
- Synthesizer doesn't need Bash (reasonable)
- But not documented

**Why it Matters**:
- Tools don't match agent responsibilities
- Users don't understand agent capabilities
- No clarity on how web search is performed
- Violates principle of least privilege (should clarify WHY each tool)

**Fix Required**:
1. Add tool justification to agent descriptions:

**researcher.md**:
```yaml
tools: TodoWrite, Read, Write, Bash, Glob, Grep
description: |
  Deep research agent for web exploration and local investigation.

  **Tools Used**:
  - **TodoWrite**: Track 6-phase research workflow
  - **Read**: Read research plan and search query instructions
  - **Write**: Write findings to explorer-N.md files
  - **Bash**: Execute web searches and local commands
  - **Glob**: Find relevant files in codebase
  - **Grep**: Search for patterns in documentation

  Examples:
  ...
```

**synthesizer.md**:
```yaml
tools: TodoWrite, Read, Write, Glob, Grep
description: |
  Research synthesis agent for consolidating multi-source findings.

  **Tools Used**:
  - **TodoWrite**: Track 7-phase synthesis workflow
  - **Read**: Read all findings files and research plan
  - **Write**: Write synthesis to iteration-N.md and final report
  - **Glob**: Discover all explorer-N.md files
  - **Grep**: Analyze and extract patterns from findings

  **Note**: No Bash (no web search or external commands)

  Examples:
  ...
```

---

### MEDIUM 5: Examples Don't Show Error Scenarios

**Location**: research.md lines 730-859 (examples)
**Category**: Documentation
**Severity**: MEDIUM

**Issue**:
All 3 examples show HAPPY PATH (success scenarios). No examples of:
1. What happens when a researcher fails
2. What happens when convergence isn't achieved
3. What happens when quality gates fail
4. What happens with native fallback (no web search)

**Examples covered**:
- Example 1: Technical topic research (success)
- Example 2: Native fallback (described but not executed)
- Example 3: Reaching iteration limit (handled gracefully)

**Missing examples**:
- Researcher timeout or API error
- Synthesizer can't consolidate findings
- Quality metrics below threshold
- User rejects research plan
- OpenRouter unavailable (fallback to native)

**Why it Matters**:
- Users don't know what "normal" failures look like
- Orchestrator implementers don't see error patterns
- Developers debug in the dark when issues occur
- Testing is harder without failure scenarios

**Fix Required**:
Add Example 4: Error Handling

```xml
<example name="Research with Partial Failure">
  <user_request>/dev:research Authentication patterns for distributed systems</user_request>
  <execution>
    PHASE 0: Create session dev-research-auth-distributed-20260106
             Detect model: GOOGLE_API_KEY found -> gemini-direct

    PHASE 1: Planner creates research plan
             User approves

    PHASE 2: Generate search queries
             4 sub-questions → 4 researcher agents

    PHASE 3 (iteration 1): Parallel exploration
             - Agent 1 (OAuth2 patterns): Success → explorer-1.md
             - Agent 2 (Token management): Success → explorer-2.md
             - Agent 3 (Distributed cache): TIMEOUT after 120s
             - Agent 4 (Service mesh auth): API 500 error

             Status: 2/4 success (meets minimum threshold)
             Log errors: ${SESSION_PATH}/errors.log contains:
               - Agent 3: Timeout searching "Redis distributed session"
               - Agent 4: Gemini API returned 500 error

    PHASE 4 (iteration 1): Synthesis
             Task: synthesizer
             Input: explorer-1.md, explorer-2.md
             Output: synthesis/iteration-1.md

             Quality Metrics:
             - Factual Integrity: 88% (just below 90% target)
             - Agreement Score: 50% (just below 60% target)
             - Status: QUALITY GATE MARGINAL

    PHASE 5: Convergence check
             - Only 1 iteration, need 3 for convergence → CONTINUE
             - Quality below threshold → CONTINUE
             - Exploration iterations: 1/5 (continue)

             Identified gaps:
             - Distributed cache topic: Agent 3 timed out
             - Service mesh auth: Agent 4 API error

             Action: Return to PHASE 3 with refined queries

    PHASE 3 (iteration 2): Focused exploration
             - Agent 3 (retry with "Redis session timeout patterns"): Success
             - Agent 4 (retry, agent API recovered): Success

             Status: 2/2 success (additional agents)

    PHASE 4 (iteration 2): Updated synthesis
             Input: explorer-1.md, explorer-2.md, explorer-3-retry.md, explorer-4-retry.md

             Quality Metrics:
             - Factual Integrity: 94% (PASS)
             - Agreement Score: 71% (PASS)

    PHASE 5: Convergence check (iteration 2)
             - Need 3 iterations for convergence → CONTINUE
             - Quality gates pass → PROCEED (Criterion 4 met)

    PHASE 3 (iteration 3): Final exploration
             No new gaps identified, continuing for convergence

    PHASE 4 (iteration 3): Final synthesis
             Findings stabilizing

    PHASE 5: Convergence check (iteration 3)
             - Similarity 82% (iterations 1, 2, 3) → CONVERGED (Criterion 1)
             - Quality passes → PROCEED

    PHASE 6: Generate final report
             - 6 key findings with 12 total sources
             - 2 retry attempts noted in methodology
             - Results saved despite partial initial failures

    Result: Research complete despite 2 initial agent failures
            Quality gates recovered through iteration
            User aware of failures via errors.log
  </execution>
</example>
```

---

## Summary Table

| Issue | Type | Severity | Location | Impact |
|-------|------|----------|----------|--------|
| Model fallback no error handling | Design | CRITICAL | lines 93-130 | Runtime failures |
| Convergence k=3 not implemented | Logic | CRITICAL | lines 409-481 | Core feature undefined |
| Agent registration inconsistency | Config | CRITICAL | plugin.json + agents/ | Tasks may fail |
| Parallel execution pattern unclear | Documentation | HIGH | lines 301-330 | Implementation ambiguity |
| Quality gate thresholds not enforced | Logic | HIGH | lines 433-436 | Quality validation missing |
| Session metadata undefined | Architecture | HIGH | lines 199-219 | State persistence broken |
| Topic slug generation edge cases | Code | MEDIUM | line 172 | File naming issues |
| No timeout handling for agents | Error Handling | MEDIUM | Phase 3, Phase 4 | Could hang indefinitely |
| Error recovery incomplete | Implementation | MEDIUM | lines 861-913 | Brittle error handling |
| Agent tools documentation unclear | Documentation | MEDIUM | researcher.md, synthesizer.md | Confusing responsibilities |
| Examples missing error scenarios | Documentation | MEDIUM | lines 730-859 | Poor learning resource |

---

## Scores by Category

| Area | Score | Status |
|------|-------|--------|
| YAML Frontmatter | 9/10 | Excellent structure, tool list correct |
| XML Structure | 8/10 | Well-formed, good organization, but some missing details |
| Completeness | 6/10 | Phases defined but implementations vague |
| Parallel Execution | 7/10 | Pattern described but not fully implemented |
| Convergence Detection | 5/10 | Pseudocode present but no executable logic |
| File Communication | 7/10 | Strategy clear but paths not fully specified |
| Error Recovery | 5/10 | Strategies listed but not implemented |
| Examples | 7/10 | Good happy-path examples, missing error cases |
| **Total** | **7.0/10** | **Needs critical fixes** |

---

## Recommendations

### Immediate Fixes (Before Release)

1. **Implement convergence detection algorithm** (CRITICAL)
   - Add bash functions to calculate intersection/union
   - Track consecutive matches in session metadata
   - Implement fallback on convergence failure

2. **Add model fallback error handling** (CRITICAL)
   - Validate OpenRouter availability in Phase 3
   - Graceful downgrade to native strategy
   - Detailed error logging

3. **Fix agent registration** (CRITICAL)
   - Verify agent names match between plugin.json and .md files
   - Add agent validation in Phase 0
   - Test agent lookup before execution

### Before Production

4. **Implement quality gate validation** (HIGH)
   - Extract metrics from synthesizer output
   - Validate against thresholds
   - Loop back to Phase 3 if below threshold

5. **Define session metadata structure** (HIGH)
   - Single JSON file that grows over time
   - Consistent field names and structure
   - Clear file path and operations

6. **Add timeout enforcement** (MEDIUM)
   - Set per-task timeouts (120s researchers, 60s synthesizer)
   - Kill hung agents and skip
   - Continue with partial results

7. **Implement error recovery** (MEDIUM)
   - Error logging to ${SESSION_PATH}/errors.log
   - User prompts for recovery options
   - Retry mechanism for failed agents

### Enhancement Suggestions

8. **Clarify parallel execution pattern** (HIGH)
   - Document `---` delimiter requirement
   - Show sequential anti-pattern
   - Explain performance implications

9. **Improve agent tool documentation** (MEDIUM)
   - Justify why each tool is needed
   - Explain how web search works
   - Add tool justification to descriptions

10. **Add error scenario examples** (MEDIUM)
    - Show researcher timeout handling
    - Show quality gate failure
    - Show user decision points

---

## Approval Decision

**Status**: CONDITIONAL PASS

**Rationale**:
The `/dev:research` command demonstrates excellent architectural thinking and sophisticated multi-agent orchestration design. The 6-phase pipeline, convergence detection strategy (k=3), and file-based communication are well-conceived.

However, three CRITICAL implementation gaps prevent immediate production use:

1. **Convergence algorithm is pseudocode, not executable** - Core completion logic undefined
2. **Model fallback has no error recovery** - OpenRouter failures cascade
3. **Agent registration may be inconsistent** - Task delegation could fail

With these three issues resolved, the implementation would be production-ready. The HIGH and MEDIUM issues represent important quality improvements but don't block basic functionality.

**Estimated Fix Time**: 4-6 hours for CRITICAL issues, 2-3 hours for HIGH priority

**Suggested Next Steps**:
1. Implement convergence detection with test cases
2. Add OpenRouter fallback error handling
3. Validate agent registration
4. Add timeout enforcement
5. Implement session metadata persistence
6. Add error recovery UX
7. Update documentation with missing details

---

## Files for Further Review

- `/Users/jack/mag/claude-code/plugins/dev/skills/core/universal-patterns` - Referenced but not reviewed
- `/Users/jack/mag/claude-code/plugins/dev/skills/context-detection` - Referenced but not reviewed
- Implementation of `dev:universal-patterns` skill used by researcher/synthesizer agents

---

**Review Complete**: January 6, 2026, 09:18:10 UTC
**Reviewed By**: DeepSeek Chat v3 via Claudish Proxy
**Session**: agentdev-researcher-20260106-091810-53a5
